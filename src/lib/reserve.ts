import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { WithholdingKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

const ZERO = new Prisma.Decimal(0);

/**
 * Which column on the bill holds each kind.
 *
 * Cutting arrived after reserve and behaves identically in every way that
 * matters — withheld by a market party, netted inside the bill, derived per
 * party, income when collected. Giving it a parallel set of functions would
 * have meant two copies of arithmetic that must never disagree, so the kind is
 * a parameter and this map is the only place the two differ.
 */
const COLUMN = {
  RESERVE: "reserve",
  CUTTING: "cutting",
} as const satisfies Record<WithholdingKind, "reserve" | "cutting">;

export const WITHHOLDING_LABELS: Record<WithholdingKind, string> = {
  RESERVE: "Reserve",
  CUTTING: "Cutting",
};

/**
 * Reserve held against one market party.
 *
 * DERIVED, never stored — and that is the whole point of this module.
 *
 * Reserve used to post to a single standing "Reserve" account, which meant
 * three market parties holding ₹2,500, ₹2,000 and ₹1,500 read as one pooled
 * ₹6,000 owed by nobody in particular. When it came time to collect, that
 * figure could not tell you who to ask. The balance is now
 *
 *     SUM(sales.reserve) − SUM(reserve collections)
 *
 * per party, which is the question the merchant actually has (spec invariant 5).
 *
 * Reserve is not in the trade ledger at all: it stays netted inside the market
 * bill, so nothing here touches a running balance. Collecting it clears this
 * derived figure and is recognised as income in the net-profit tier.
 */
export type ReserveBalance = {
  partyId: string;
  partyName: string;
  withheld: Prisma.Decimal;
  collected: Prisma.Decimal;
  /** withheld − collected. What this party still holds. */
  outstanding: Prisma.Decimal;
};

export async function reserveBalances(
  scope: {
    companyId: string;
    centreId: string;
  },
  kind: WithholdingKind = "RESERVE"
): Promise<ReserveBalance[]> {
  const column = COLUMN[kind];
  // Two grouped aggregates rather than a row-by-row walk: both are indexed on
  // (company, centre) and the party count is small, so this stays two queries
  // however many bills there are.
  const [withheldRows, collectedRows] = await Promise.all([
    prisma.sale.groupBy({
      by: ["partyId"],
      where: { ...scope, type: "MARKET", [column]: { not: null } },
      // Both columns summed, one read. The unasked-for one costs nothing and
      // keeps this a single query shape rather than two near-identical ones.
      _sum: { reserve: true, cutting: true },
    }),
    prisma.reserveCollection.groupBy({
      by: ["partyId"],
      where: { ...scope, kind },
      _sum: { amount: true },
    }),
  ]);

  const withheld = new Map(
    withheldRows.map((r) => [r.partyId, r._sum[column] ?? ZERO])
  );
  const collected = new Map(
    collectedRows.map((r) => [r.partyId, r._sum.amount ?? ZERO])
  );

  // A party that has only ever been collected FROM still belongs in the list —
  // its balance would read as negative, which is a real signal that more was
  // collected than was ever withheld.
  const partyIds = [...new Set([...withheld.keys(), ...collected.keys()])];
  if (partyIds.length === 0) return [];

  const parties = await prisma.party.findMany({
    where: { id: { in: partyIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(parties.map((p) => [p.id, p.name]));

  return partyIds
    .map((partyId) => {
      const w = withheld.get(partyId) ?? ZERO;
      const c = collected.get(partyId) ?? ZERO;
      return {
        partyId,
        partyName: nameById.get(partyId) ?? "Unknown party",
        withheld: w,
        collected: c,
        outstanding: w.sub(c),
      };
    })
    .sort(
      (a, b) =>
        b.outstanding.comparedTo(a.outstanding) ||
        a.partyName.localeCompare(b.partyName)
    );
}

/** What one market party still holds. Used to cap a collection. */
export async function reserveOutstandingFor(
  scope: { companyId: string; centreId: string },
  partyId: string,
  kind: WithholdingKind = "RESERVE"
): Promise<Prisma.Decimal> {
  const column = COLUMN[kind];
  const [withheld, collected] = await Promise.all([
    prisma.sale.aggregate({
      where: { ...scope, type: "MARKET", partyId },
      _sum: { reserve: true, cutting: true },
    }),
    prisma.reserveCollection.aggregate({
      where: { ...scope, partyId, kind },
      _sum: { amount: true },
    }),
  ]);
  return (withheld._sum[column] ?? ZERO).sub(collected._sum.amount ?? ZERO);
}

/**
 * Withholdings collected in a period — the figure that lifts NET profit.
 *
 * BOTH kinds, deliberately unfiltered. Reserve and cutting are the same money
 * to the profit statement: BFM's own rupees that a market held back and has now
 * handed over. Splitting them here would mean a caller had to remember to ask
 * for both and add them up, and the day somebody forgot, net profit would
 * quietly understate. The split matters when deciding who to chase, which is
 * what reserveBalances is for.
 *
 * Recognised on the day the money actually arrived, which is the one date in
 * the system that is not a buying day: the collection usually happens at year
 * end, long after the bills it relates to.
 */
export async function reserveCollectedBetween(
  scope: { companyId: string; centreId: string | null },
  from: Date,
  to: Date
): Promise<Prisma.Decimal> {
  const r = await prisma.reserveCollection.aggregate({
    where: {
      companyId: scope.companyId,
      ...(scope.centreId ? { centreId: scope.centreId } : {}),
      date: { gte: from, lte: to },
    },
    _sum: { amount: true },
  });
  return r._sum.amount ?? ZERO;
}
