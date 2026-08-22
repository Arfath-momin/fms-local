"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry, requireSuperAdmin } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { findOrCreateParty } from "@/lib/party-db";
import { normaliseVehicleNumber } from "@/lib/vehicle";

export type VehicleFormState = { error: string } | null;

/**
 * Read and validate the two fields every vehicle form submits.
 *
 * The number is normalised here rather than at the database, because it is the
 * identity: "KA-20-B-5521", "KA20B5521" and "ka 20 b 5521" are one truck, and
 * storing them as typed made them three — none of which pointed at a
 * transporter to owe rent to.
 */
function parse(
  formData: FormData
): { error: string } | { number: string; transporterName: string } {
  const raw = String(formData.get("number") ?? "").trim();
  const transporterName = String(formData.get("transporterName") ?? "")
    .trim()
    .replace(/\s+/g, " ");

  const number = normaliseVehicleNumber(raw);
  if (!number) return { error: "Enter the vehicle number." };
  if (number.length > 20) return { error: "That vehicle number is too long." };
  if (!transporterName)
    return { error: "Enter the transporter — the rent is owed to them." };

  return { number, transporterName };
}

/**
 * Add a vehicle to the active company, creating its transporter if new.
 *
 * Vehicles are company-scoped where parties are not: BFM and B2B may well use
 * the same truck, but each keeps its own row so archiving one company's does
 * not touch the other's trips. The TRANSPORTER party underneath is shared,
 * exactly like every other party.
 */
export async function createVehicle(
  _prev: VehicleFormState,
  formData: FormData
): Promise<VehicleFormState> {
  // Entry-level, not admin: whoever enters a delivery note is the person who
  // discovers a new truck, and sending them to find an admin only means the
  // number gets typed into a note as free text instead.
  await requireEntry();
  const parsed = parse(formData);
  if ("error" in parsed) return parsed;

  const company = await getActiveCompany();
  try {
    await prisma.$transaction(async (tx) => {
      const transporterId = await findOrCreateParty(
        tx,
        parsed.transporterName,
        "TRANSPORTER"
      );
      await tx.vehicle.create({
        data: { companyId: company.id, number: parsed.number, transporterId },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return {
        error: `${company.name} already has a vehicle numbered ${parsed.number}.`,
      };
    return { error: e instanceof Error ? e.message : "Could not add vehicle." };
  }

  revalidatePath("/masters/vehicles");
  redirect("/masters/vehicles");
}

/**
 * Change a vehicle's number, or move it to a different transporter.
 *
 * Reassigning is deliberately a separate, deliberate act rather than a side
 * effect of typing a name on a delivery note (see findOrCreateVehicle, which
 * never overwrites the transporter). A truck changing hands is real, but past
 * trips keep pointing at this same vehicle row — and therefore at the NEW
 * transporter, which is why only an admin may do it.
 */
export async function updateVehicle(
  vehicleId: string,
  _prev: VehicleFormState,
  formData: FormData
): Promise<VehicleFormState> {
  await requireAdmin();
  const parsed = parse(formData);
  if ("error" in parsed) return parsed;

  const company = await getActiveCompany();
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.vehicle.findFirst({
        where: { id: vehicleId, companyId: company.id },
        select: { id: true },
      });
      if (!existing) throw new Error("That vehicle no longer exists.");

      const transporterId = await findOrCreateParty(
        tx,
        parsed.transporterName,
        "TRANSPORTER"
      );
      await tx.vehicle.update({
        where: { id: vehicleId },
        data: { number: parsed.number, transporterId },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return {
        error: `${company.name} already has a vehicle numbered ${parsed.number}.`,
      };
    return { error: e instanceof Error ? e.message : "Could not save vehicle." };
  }

  revalidatePath("/masters/vehicles");
  redirect("/masters/vehicles");
}

/** How many trips this vehicle has carried. Deleting is only safe at zero. */
async function vehicleUsage(vehicleId: string, companyId: string) {
  const v = await prisma.vehicle.findFirst({
    where: { id: vehicleId, companyId },
    select: {
      number: true,
      archivedAt: true,
      _count: { select: { trips: true } },
    },
  });
  if (!v) return null;
  return { number: v.number, archivedAt: v.archivedAt, trips: v._count.trips };
}

/**
 * Retire a vehicle. Its trips stay exactly as they are and every transporter
 * ledger reads unchanged; it simply stops being offered when a new trip is
 * entered.
 */
export async function archiveVehicle(
  vehicleId: string,
  _prev: VehicleFormState,
  _formData: FormData
): Promise<VehicleFormState> {
  await requireAdmin();
  const company = await getActiveCompany();

  const usage = await vehicleUsage(vehicleId, company.id);
  if (!usage) return { error: "That vehicle no longer exists." };
  if (usage.archivedAt) return { error: `${usage.number} is already archived.` };

  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { archivedAt: new Date() },
  });
  revalidatePath("/masters/vehicles");
  return null;
}

/** Bring an archived vehicle back into the trip picker. Super admin only. */
export async function unarchiveVehicle(
  vehicleId: string,
  _prev: VehicleFormState,
  _formData: FormData
): Promise<VehicleFormState> {
  await requireSuperAdmin();
  const company = await getActiveCompany();

  const usage = await vehicleUsage(vehicleId, company.id);
  if (!usage) return { error: "That vehicle no longer exists." };

  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { archivedAt: null },
  });
  revalidatePath("/masters/vehicles");
  return null;
}

/**
 * Delete a vehicle for good — super admin only, and only when it has carried
 * nothing. A vehicle with even one trip is archived instead: the trip's rent
 * is posted against its transporter, and removing the vehicle would orphan the
 * only record of which truck that rent was for.
 */
export async function deleteVehicle(
  vehicleId: string,
  _prev: VehicleFormState,
  _formData: FormData
): Promise<VehicleFormState> {
  await requireSuperAdmin();
  const company = await getActiveCompany();

  const usage = await vehicleUsage(vehicleId, company.id);
  if (!usage) return { error: "That vehicle no longer exists." };
  if (usage.trips > 0) {
    return {
      error:
        `${usage.number} has carried ${usage.trips} trip${usage.trips === 1 ? "" : "s"} ` +
        `and cannot be deleted — archive it instead, which stops it being ` +
        `offered on a new trip while its history reads exactly as it does now.`,
    };
  }

  await prisma.vehicle.delete({ where: { id: vehicleId } });
  revalidatePath("/masters/vehicles");
  return null;
}
