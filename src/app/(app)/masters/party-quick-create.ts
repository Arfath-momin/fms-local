"use server";

import { revalidatePath } from "next/cache";
import type { PartyType, PurchaseType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireEntry } from "@/lib/session";
import { findOrCreateParty } from "@/lib/party-db";
import { PARTY_TYPES } from "@/lib/party";
import { PURCHASE_TYPES } from "@/lib/purchase";

export type QuickCreateResult =
  | { error: string }
  | { party: { id: string; name: string; type: PartyType } };

/**
 * Create a master party from inside an entry form, immediately.
 *
 * This exists because the combobox's "Add … to master" button used to be a
 * label with no action behind it: it closed the dropdown and left creation to
 * findOrCreateParty at save time. That reads fine on a single field and breaks
 * down the moment a voucher has more than one — adding "Raju Boat" on row 1
 * wrote nothing to the database, so row 2 searched, found nothing, and offered
 * to add it again. On a ten-row Society bill the same boat had to be "added"
 * ten times, and none of those clicks did anything.
 *
 * Creating on click makes the button do what it says. The name is then a real
 * master row that every later row, every later voucher and the Masters screen
 * can all see.
 *
 * Deliberately reuses findOrCreateParty rather than prisma.party.create: it is
 * the same resolution the voucher actions perform on save, so a name that
 * already exists returns that party instead of colliding on the unique
 * (name, type), and an archived one is revived exactly as saving would revive
 * it. Two people adding the same boat at once therefore both succeed.
 */
export async function quickCreateParty(
  name: string,
  type: PartyType,
  purchaseKind?: PurchaseType | null
): Promise<QuickCreateResult> {
  // Same permission as entering a voucher — this is reached only from an entry
  // form, and an auditor has no entry form to reach it from.
  await requireEntry();

  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return { error: "Enter a name first." };
  if (clean.length > 120) return { error: "That name is too long." };

  // Never trust the arguments: a server action is a public endpoint, so the
  // enums are re-checked here rather than assumed from the calling component.
  if (!PARTY_TYPES.includes(type)) return { error: "Unknown party type." };
  const kind =
    purchaseKind && PURCHASE_TYPES.includes(purchaseKind)
      ? purchaseKind
      : undefined;

  const id = await prisma.$transaction((tx) =>
    findOrCreateParty(tx, clean, type, kind)
  );

  // The Masters list and the pickers that read it should show the new name
  // without a reload.
  revalidatePath("/masters/parties");

  return { party: { id, name: clean, type } };
}
