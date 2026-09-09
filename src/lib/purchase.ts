import type { PurchaseType } from "@/generated/prisma/enums";

export const PURCHASE_TYPE_LABELS: Record<PurchaseType, string> = {
  SOCIETY: "Society",
  KFDC: "KFDC",
  PRIVATE: "Private",
  LOCAL: "Local",
};

export const PURCHASE_TYPES = Object.keys(
  PURCHASE_TYPE_LABELS
) as PurchaseType[];

/**
 * Split purchase parties into the sections the ledger list prints.
 *
 * Society and KFDC are one account each and come first, unheaded — a "Society"
 * heading above a single row called Society tells the reader nothing. Everyone
 * else is filed under what they sell through, because Private and Local are
 * lists of individuals that grow every season, and finding who is still owed
 * for local fish meant reading one A-to-Z column and picking names out by eye.
 *
 * The property worth guarding is that EVERY party lands in exactly one section.
 * A seller dropped from this list is money owed that nobody can see — so a
 * party whose kind was never filled in gets a section of its own rather than
 * falling through the four known kinds.
 */
export function groupPurchaseParties<
  T extends { name: string; purchaseKind: PurchaseType | null },
>(
  rows: T[],
  standingNames: string[],
  unfiledLabel = "Not yet filed"
): { label: string | null; rows: T[] }[] {
  const standing = rows.filter((r) => standingNames.includes(r.name));
  const rest = rows.filter((r) => !standingNames.includes(r.name));

  const groups: { label: string | null; rows: T[] }[] = [];
  if (standing.length > 0) groups.push({ label: null, rows: standing });
  for (const kind of PURCHASE_TYPES) {
    const kindRows = rest.filter((r) => r.purchaseKind === kind);
    if (kindRows.length > 0)
      groups.push({ label: PURCHASE_TYPE_LABELS[kind], rows: kindRows });
  }
  const unfiled = rest.filter((r) => r.purchaseKind === null);
  if (unfiled.length > 0) groups.push({ label: unfiledLabel, rows: unfiled });
  return groups;
}
