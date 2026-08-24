"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry, requireSuperAdmin } from "@/lib/session";
import { PARTY_TYPES } from "@/lib/party";
import type { PartyType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export type PartyFormState = { error: string } | null;

/**
 * Everything that can point at a party. Deleting is only safe at zero.
 *
 * `satisfies`, not `as const`. Written as a bare literal this was never checked
 * against the schema at all, and it silently kept `purchasesAsBoat` after the
 * rebuild dropped Purchase.boatId — so every delete threw
 * PrismaClientValidationError at runtime while `tsc` stayed green. Two
 * relations added at the same time were missing for the same reason, which is
 * the worse half of the bug: a transporter with vehicles, or a market party
 * with reserve collections, would have counted as unreferenced and been
 * deleted. Typed like this, the next relation added to Party breaks the build
 * here instead.
 */
const PARTY_REFERENCES = {
  purchases: true,
  purchaseLinesAsBoat: true,
  expenses: true,
  ledgerEntries: true,
  salesAsBuyer: true,
  salesAsCareOf: true,
  settlements: true,
  vehicles: true,
  reserveCollections: true,
} satisfies Prisma.PartyCountOutputTypeSelect;

type ParseResult =
  | { error: string }
  | { data: { name: string; type: PartyType; contactInfo: string | null } };

function parsePartyForm(formData: FormData): ParseResult {
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "") as PartyType;
  const contactInfo = String(formData.get("contactInfo") ?? "").trim();

  if (!name) return { error: "Party name is required." };
  if (!PARTY_TYPES.includes(type)) return { error: "Choose a party type." };

  return { data: { name, type, contactInfo: contactInfo || null } };
}

export async function createParty(
  _prev: PartyFormState,
  formData: FormData
): Promise<PartyFormState> {
  await requireEntry();
  const parsed = parsePartyForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  await prisma.party.create({ data: parsed.data });
  revalidatePath("/masters/parties");
  redirect("/masters/parties");
}

export async function updateParty(
  partyId: string,
  _prev: PartyFormState,
  formData: FormData
): Promise<PartyFormState> {
  await requireEntry();
  const parsed = parsePartyForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  await prisma.party.update({ where: { id: partyId }, data: parsed.data });
  revalidatePath("/masters/parties");
  redirect("/masters/parties");
}

// ---------------------------------------------------------------------------
// Retiring a party
//
// Three operations behind what the merchant sees as one "Delete" button:
//
//   archive    admin and up. Hides the party from the pickers and the master
//              list. Every voucher, ledger entry and report is untouched.
//   restore    super admin only. Undoing the merchant's housekeeping puts a
//              name they chose to remove back into every picker.
//   delete     super admin only, and only when nothing at all references the
//              party — the mistyped name that created a master row on its
//              first and only use. Anything with history can never be deleted.
// ---------------------------------------------------------------------------

/** How many records point at this party, and whether it is already archived. */
async function partyUsage(partyId: string) {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { name: true, archivedAt: true, _count: { select: PARTY_REFERENCES } },
  });
  if (!party) return null;
  const references = Object.values(party._count).reduce((a, b) => a + b, 0);
  return { name: party.name, archivedAt: party.archivedAt, references };
}

/**
 * Retire a party. Admin and up — this is ordinary housekeeping and it destroys
 * nothing, which is why it is not gated to the super admin the way restoring
 * and deleting are.
 */
export async function archiveParty(
  partyId: string,
  _prev: PartyFormState,
  _formData: FormData
): Promise<PartyFormState> {
  await requireAdmin();

  const usage = await partyUsage(partyId);
  if (!usage) return { error: "That party no longer exists." };
  if (usage.archivedAt) return { error: `${usage.name} is already archived.` };

  await prisma.party.update({
    where: { id: partyId },
    data: { archivedAt: new Date() },
  });
  revalidatePath("/masters/parties");
  revalidatePath("/masters");
  return null;
}

/** Bring an archived party back into the pickers. Super admin only. */
export async function unarchiveParty(
  partyId: string,
  _prev: PartyFormState,
  _formData: FormData
): Promise<PartyFormState> {
  await requireSuperAdmin();

  const usage = await partyUsage(partyId);
  if (!usage) return { error: "That party no longer exists." };

  await prisma.party.update({
    where: { id: partyId },
    data: { archivedAt: null },
  });
  revalidatePath("/masters/parties");
  revalidatePath("/masters");
  return null;
}

/**
 * Delete a party for good. Super admin only, and refused outright the moment
 * anything references it — the row is what a purchase, a sale or a ledger entry
 * resolves its name through, so removing it would blank out history rather than
 * tidy it. Those are archived instead, forever.
 */
export async function deleteParty(
  partyId: string,
  _prev: PartyFormState,
  _formData: FormData
): Promise<PartyFormState> {
  await requireSuperAdmin();

  const usage = await partyUsage(partyId);
  if (!usage) return { error: "That party no longer exists." };
  if (usage.references > 0) {
    return {
      error:
        `${usage.name} is used by ${usage.references} record${usage.references === 1 ? "" : "s"} ` +
        `and cannot be deleted — archive it instead, which hides it everywhere ` +
        `except the records it already appears on.`,
    };
  }

  await prisma.party.delete({ where: { id: partyId } });
  revalidatePath("/masters/parties");
  revalidatePath("/masters");
  return null;
}
