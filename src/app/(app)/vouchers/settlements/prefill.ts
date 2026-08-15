import "server-only";
import type { SettlementKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { SETTLEMENT_PARTY_TYPES } from "@/lib/settlement";
import type { PartyOption } from "../../masters/party-combobox";

/**
 * Resolve a `?partyId=` on New Payment / New Receipt into a prefilled party.
 *
 * This is what makes an outstanding balance actionable: the merchant reads a
 * ledger, sees who owes what, and clicks straight through to the voucher that
 * settles it rather than retyping the name into a picker and hoping it is the
 * same party.
 *
 * It returns the party's balance as well as its name, and that is the point —
 * the form's "previous / after this receipt" panel is driven by the selected
 * party, so a name filled in without one would land the merchant on a screen
 * showing no position at all, and they would have to re-pick the party they had
 * just chosen to get it back.
 *
 * The party's type is re-checked against the kind on the way through. A link is
 * just a URL — a hand-edited one naming a supplier on a receipt would otherwise
 * prefill a form that posts to the wrong side of the ledger. Anything that does
 * not fit returns undefined, which simply leaves the field empty.
 */
export async function prefilledParty(
  kind: SettlementKind,
  partyId: string | undefined,
  scope: { companyId: string; centreId: string }
): Promise<PartyOption | undefined> {
  if (!partyId) return undefined;

  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { id: true, name: true, type: true },
  });
  if (!party) return undefined;
  // An archived party keeps its ledger and can still be settled — that is the
  // point of archiving rather than deleting — so it is deliberately allowed.
  if (!SETTLEMENT_PARTY_TYPES[kind].includes(party.type)) return undefined;

  // The newest entry's stored running balance is the position now — one
  // indexed lookup, and the same figure the party statement puts in its header
  // rather than a second way of arriving at it.
  const latest = await prisma.ledgerEntry.findFirst({
    where: { ...scope, partyId },
    orderBy: [{ date: "desc" }, { seq: "desc" }],
    select: { runningBalance: true },
  });

  return {
    id: party.id,
    name: party.name,
    type: party.type,
    balance: Number(latest?.runningBalance ?? 0),
  };
}
