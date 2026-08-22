import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findOrCreateParty } from "@/lib/party-db";

/**
 * Vehicle numbers, normalised.
 *
 * "KA-20-B-5521", "KA20B5521" and "ka 20 b 5521" are one truck, and storing
 * them as typed made them three. Everything is uppercased with separators
 * stripped, so a lookup can never miss on formatting. How it is DISPLAYED is a
 * separate question the UI answers; this is the identity.
 */
export function normaliseVehicleNumber(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Resolve a typed vehicle number and transporter name to a Vehicle row.
 *
 * Find-or-create, matching how every voucher already resolves a party by name:
 * the entry forms are text today and become pickers in Phase 1, and this is the
 * seam that lets both work without the action caring which it was.
 *
 * The transporter is required because rent has to be owed to somebody — a
 * vehicle with no transporter is a trip whose rent can never be settled, and
 * the whole point of the model is that a transporter's balance closing at zero
 * is the signal that it was.
 */
export async function findOrCreateVehicle(
  tx: Prisma.TransactionClient,
  args: { companyId: string; number: string; transporterName: string }
): Promise<{ id: string; transporterId: string }> {
  const number = normaliseVehicleNumber(args.number);
  if (!number) throw new Error("A vehicle number is required.");

  const transporterId = await findOrCreateParty(
    tx,
    args.transporterName.trim().replace(/\s+/g, " "),
    "TRANSPORTER"
  );

  const existing = await tx.vehicle.findUnique({
    where: { companyId_number: { companyId: args.companyId, number } },
    select: { id: true, transporterId: true, archivedAt: true },
  });

  if (existing) {
    // A retired truck coming back into use revives rather than colliding on
    // the unique (company, number) — the same rule parties follow.
    if (existing.archivedAt) {
      await tx.vehicle.update({
        where: { id: existing.id },
        data: { archivedAt: null },
      });
    }
    // The transporter is NOT overwritten. A truck changing hands is a real
    // event worth doing deliberately from Masters, not a side effect of
    // someone typing a different name on a delivery note.
    return { id: existing.id, transporterId: existing.transporterId };
  }

  const created = await tx.vehicle.create({
    data: { companyId: args.companyId, number, transporterId },
    select: { id: true, transporterId: true },
  });
  return created;
}

/**
 * The vehicles a new trip may be entered against, for the active company.
 *
 * Archived trucks are excluded deliberately: retiring one is how a merchant
 * says "stop using this", and offering it anyway would make the archive
 * decorative. An existing trip keeps pointing at its vehicle either way.
 */
export async function liveVehicles(companyId: string) {
  const rows = await prisma.vehicle.findMany({
    where: { companyId, archivedAt: null },
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      transporter: { select: { name: true } },
    },
  });
  return rows.map((v) => ({
    id: v.id,
    number: v.number,
    transporterName: v.transporter.name,
  }));
}
