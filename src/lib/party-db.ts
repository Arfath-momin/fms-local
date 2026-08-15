import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { PartyType, PurchaseType } from "@/generated/prisma/enums";

/**
 * Resolve a typed name to a Party, creating it on first use. Parties are
 * global (shared across companies); the ledger that accumulates against them
 * is per company. Names are trimmed and space-collapsed so "Boat A" and
 * "Boat  A" map to the same party rather than splitting a ledger.
 *
 * An archived party matching the name is revived rather than skipped. It has to
 * be: (name, type) is unique, so creating a second one would fail outright. But
 * reviving is also the right answer — a retired boat that starts landing again
 * should continue on the ledger it already has, not begin a fresh one at zero
 * while its outstanding balance sits on a row nobody can see.
 *
 * This is the one way an admin brings a party back without the super admin who
 * normally owns un-archiving, and that is a deliberate trade: the alternative is
 * refusing to save a real voucher for a party that demonstrably exists. Note it
 * takes the exact name to trigger — the picker never offers archived rows — so
 * it is reached by someone typing a name they know, not by browsing.
 *
 * `purchaseKind` records which kind of purchase a PURCHASE_GROUP party sells
 * through, so the purchase form can suggest only private sellers on a Private
 * bill. It is filled in on creation and, for a party that has none yet, on the
 * next purchase that names them — which is what lets a party predating the
 * column, or one added by hand from Masters, sort itself out through ordinary
 * use instead of needing anyone to go and edit it. An existing kind is never
 * overwritten: a seller who appears on one Local bill by mistake should not be
 * silently reclassified out of the list they belong in.
 */
export async function findOrCreateParty(
  tx: Prisma.TransactionClient,
  name: string,
  type: PartyType,
  purchaseKind?: PurchaseType
): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  const existing = await tx.party.findUnique({
    where: { name_type: { name: clean, type } },
    select: { id: true, archivedAt: true, purchaseKind: true },
  });
  if (existing) {
    const revive = existing.archivedAt ? { archivedAt: null } : {};
    const classify =
      purchaseKind && !existing.purchaseKind ? { purchaseKind } : {};
    if (Object.keys(revive).length || Object.keys(classify).length) {
      await tx.party.update({
        where: { id: existing.id },
        data: { ...revive, ...classify },
      });
    }
    return existing.id;
  }
  const created = await tx.party.create({
    data: { name: clean, type, purchaseKind: purchaseKind ?? null },
    select: { id: true },
  });
  return created.id;
}
