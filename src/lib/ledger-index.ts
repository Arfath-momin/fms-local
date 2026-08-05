import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { PartyType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

export type LedgerRow = {
  id: string;
  name: string;
  type: PartyType;
  balance: Prisma.Decimal;
  entries: number;
};

const ZERO = new Prisma.Decimal(0);

/**
 * The ledgers of one section, for the active centre.
 *
 * Only parties that actually have a ledger here are listed. The party master is
 * global and grows without bound — every boat, every one-off buyer — so listing
 * all of them turned each section into a wall of permanent zeros with the three
 * or four accounts that matter buried inside it. `alwaysInclude` names the
 * standing accounts that should appear even before their first transaction
 * (Society, KFDC, Local Individuals), so a fresh centre still shows its shape.
 */
export async function sectionLedgers(
  scope: { companyId: string; centreId: string },
  types: PartyType[],
  alwaysInclude: string[] = []
): Promise<LedgerRow[]> {
  const where = {
    companyId: scope.companyId,
    centreId: scope.centreId,
    party: { type: { in: types } },
  };

  const [latest, counts, parties] = await Promise.all([
    // Latest entry per party = its balance now; `distinct` picks the first row
    // per party in this ordering. (date, seq) is the ledger's total order.
    prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ date: "desc" }, { seq: "desc" }],
      distinct: ["partyId"],
      select: { partyId: true, runningBalance: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ["partyId"],
      where,
      _count: true,
    }),
    prisma.party.findMany({
      where: { type: { in: types } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
  ]);

  const balances = new Map(latest.map((e) => [e.partyId, e.runningBalance]));
  const entryCounts = new Map(counts.map((c) => [c.partyId, c._count]));
  const standing = new Set(alwaysInclude);

  return parties
    .filter((p) => balances.has(p.id) || standing.has(p.name))
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      balance: balances.get(p.id) ?? ZERO,
      entries: entryCounts.get(p.id) ?? 0,
    }));
}

/** Net of a set of ledgers — the section's position in one figure. */
export function totalBalance(rows: LedgerRow[]): Prisma.Decimal {
  return rows.reduce((acc, r) => acc.add(r.balance), ZERO);
}
