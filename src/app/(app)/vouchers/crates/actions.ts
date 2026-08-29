"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { getActiveScope, requireSubmittedScope } from "@/lib/centre";
import { findOrCreateParty } from "@/lib/party-db";

export type CrateFormState = { error: string } | null;

const clean = (v: FormDataEntryValue | null) =>
  String(v ?? "").trim().replace(/\s+/g, " ");

const COUNT = /^\d{1,6}$/;

type Parsed = {
  partyName: string;
  date: Date;
  deliveryNoteId: string | null;
  place: string | null;
  boxesOut: number;
  boxesReturned: number;
  notes: string | null;
};

async function parse(
  formData: FormData,
  companyId: string
): Promise<{ error: string } | { data: Parsed }> {
  const partyName = clean(formData.get("partyName"));
  const dateRaw = String(formData.get("date") ?? "");
  const outRaw = clean(formData.get("boxesOut")) || "0";
  const backRaw = clean(formData.get("boxesReturned")) || "0";
  const place = clean(formData.get("place"));
  const notes = clean(formData.get("notes"));

  if (!partyName) return { error: "Enter the market party." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw))
    return { error: "Pick the date." };
  // Whole crates only. There is no such thing as half a box coming back, and
  // allowing a fraction would put one into a count the merchant reads as
  // objects on the ground.
  if (!COUNT.test(outRaw))
    return { error: "Boxes sent must be a whole number." };
  if (!COUNT.test(backRaw))
    return { error: "Boxes returned must be a whole number." };

  const boxesOut = Number(outRaw);
  const boxesReturned = Number(backRaw);
  if (boxesOut === 0 && boxesReturned === 0)
    return {
      error: "Enter the crates sent, the crates returned, or both.",
    };

  // The trip, checked against this company rather than trusted from the form.
  // A row without one is an opening balance and is perfectly legitimate.
  const tripIdRaw = clean(formData.get("deliveryNoteId"));
  let deliveryNoteId: string | null = null;
  if (tripIdRaw) {
    const trip = await prisma.deliveryNote.findFirst({
      where: { id: tripIdRaw, companyId },
      select: { id: true },
    });
    if (!trip) return { error: "That trip could not be found." };
    deliveryNoteId = trip.id;
  }

  return {
    data: {
      partyName,
      date: new Date(dateRaw),
      deliveryNoteId,
      place: place || null,
      boxesOut,
      boxesReturned,
      notes: notes || null,
    },
  };
}

/**
 * Record crates out to, or back from, a market party.
 *
 * Deliberately NOT a ledger entry. Crates are not money: they are BFM's own
 * property on loan, and posting them to a party's trade ledger would mix a
 * count of wooden boxes into a balance measured in rupees. The account is its
 * own statement, derived from these rows.
 */
export async function createCrateEntry(
  _prev: CrateFormState,
  formData: FormData
): Promise<CrateFormState> {
  const session = await requireEntry();
  const scoped = await requireSubmittedScope(formData);
  if ("error" in scoped) return { error: scoped.error };
  const { company, centre } = scoped.scope;

  const parsed = await parse(formData, company.id);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      // Crates only ever go to somebody who takes a load, which is a market
      // buyer. Creating the party here means a new market can be recorded on
      // the spot rather than being a trip to Masters first.
      const partyId = await findOrCreateParty(tx, d.partyName, "MARKET_BUYER");
      await tx.crateEntry.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          partyId,
          date: d.date,
          deliveryNoteId: d.deliveryNoteId,
          place: d.place,
          boxesOut: d.boxesOut,
          boxesReturned: d.boxesReturned,
          notes: d.notes,
          createdById: session.userId,
        },
      });
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not record the crates.",
    };
  }

  revalidatePath("/ledgers/boxes");
  revalidatePath("/vouchers/crates");
  redirect("/ledgers/boxes");
}

/**
 * Remove a crate row. Admin only, like every other voucher correction.
 *
 * Nothing to unpost: every balance is derived, so the account simply reads
 * correctly again the moment the row is gone.
 */
export async function deleteCrateEntry(
  entryId: string,
  _prev: CrateFormState
): Promise<CrateFormState> {
  await requireAdmin();
  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    const existing = await prisma.crateEntry.findFirst({
      // Scoped: an admin may only remove a row belonging to the company and
      // centre they are working in.
      where: { id: entryId, companyId: company.id, centreId: centre.id },
      select: { id: true },
    });
    if (!existing) return { error: "That row no longer exists." };
    await prisma.crateEntry.delete({ where: { id: entryId } });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not remove the row.",
    };
  }

  revalidatePath("/ledgers/boxes");
  return null;
}
