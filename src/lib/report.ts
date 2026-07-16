import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

const ZERO = new Prisma.Decimal(0);

/** Aged-outstanding threshold: confirmed 90 days (spec §3.7, decided 2026-07-15). */
export const AGED_LOSS_DAYS = 90;

/** Weighted-average purchase cost per kg per fish type, using purchases up to a date. */
export async function getAvgCostMap(
  companyId: string,
  upTo: Date
): Promise<Map<string, Prisma.Decimal>> {
  const groups = await prisma.purchase.groupBy({
    by: ["fishType"],
    where: { companyId, date: { lte: upTo } },
    _sum: { amount: true, qtyKg: true },
  });
  const map = new Map<string, Prisma.Decimal>();
  for (const g of groups) {
    const qty = g._sum.qtyKg ?? ZERO;
    if (qty.greaterThan(0)) map.set(g.fishType, (g._sum.amount ?? ZERO).div(qty));
  }
  return map;
}

/** Each party's running balance as of a date (parties without entries omitted). */
export async function getBalancesAsOf(
  companyId: string,
  asOf: Date
): Promise<Map<string, Prisma.Decimal>> {
  const latest = await prisma.ledgerEntry.findMany({
    where: { companyId, date: { lte: asOf } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    distinct: ["partyId"],
    select: { partyId: true, runningBalance: true },
  });
  return new Map(latest.map((e) => [e.partyId, e.runningBalance]));
}

export type PnL = {
  revenue: Prisma.Decimal;
  cogs: Prisma.Decimal;
  spoilage: Prisma.Decimal;
  grossProfit: Prisma.Decimal;
  expensesByCategory: { category: string; amount: Prisma.Decimal }[];
  totalExpenses: Prisma.Decimal;
  agedLoss: Prisma.Decimal;
  netProfit: Prisma.Decimal;
};

/**
 * Accrual P&L for [from, to]:
 *  - revenue at locked rates (variance debt is still revenue receivable)
 *    plus direct sales
 *  - COGS and spoilage valued at weighted-average purchase cost
 *  - uncollected balances older than AGED_LOSS_DAYS counted as loss
 *    automatically (spec §3.7) — never manually written off.
 */
export async function computePnL(
  companyId: string,
  from: Date,
  to: Date
): Promise<PnL> {
  const dateRange = { gte: from, lte: to };
  const [settlements, directSaleAgg, soldMoves, lossMoves, expenseGroups, avgCost] =
    await Promise.all([
      prisma.settlement.findMany({
        where: { date: dateRange, deliveryNote: { companyId } },
        include: { deliveryNote: { select: { rate: true } } },
      }),
      prisma.directSale.aggregate({
        where: { companyId, date: dateRange },
        _sum: { amount: true },
      }),
      prisma.stockMovement.groupBy({
        by: ["fishType"],
        where: { companyId, date: dateRange, state: "SOLD", direction: "IN" },
        _sum: { qtyKg: true },
      }),
      prisma.stockMovement.groupBy({
        by: ["fishType"],
        where: { companyId, date: dateRange, state: "LOSS", direction: "IN" },
        _sum: { qtyKg: true },
      }),
      prisma.expense.groupBy({
        by: ["category"],
        where: { companyId, date: dateRange },
        _sum: { amount: true },
      }),
      getAvgCostMap(companyId, to),
    ]);

  const revenue = settlements
    .reduce((acc, s) => acc.add(s.qtyAccepted.mul(s.deliveryNote.rate)), ZERO)
    .add(directSaleAgg._sum.amount ?? ZERO);

  const costOf = (groups: typeof soldMoves) =>
    groups.reduce((acc, g) => {
      const cost = avgCost.get(g.fishType);
      return cost ? acc.add((g._sum.qtyKg ?? ZERO).mul(cost)) : acc;
    }, ZERO);
  const cogs = costOf(soldMoves);
  const spoilage = costOf(lossMoves);
  const grossProfit = revenue.sub(cogs).sub(spoilage);

  const expensesByCategory = expenseGroups
    .map((g) => ({ category: g.category, amount: g._sum.amount ?? ZERO }))
    .sort((a, b) => a.category.localeCompare(b.category));
  const totalExpenses = expensesByCategory.reduce(
    (acc, e) => acc.add(e.amount),
    ZERO
  );

  // Aged loss: debt that already existed AGED_LOSS_DAYS before period end
  // and is still outstanding at period end.
  const cutoff = new Date(to.getTime() - AGED_LOSS_DAYS * 86_400_000);
  const [balancesAtCutoff, balancesAtEnd] = await Promise.all([
    getBalancesAsOf(companyId, cutoff),
    getBalancesAsOf(companyId, to),
  ]);
  let agedLoss = ZERO;
  for (const [partyId, atCutoff] of balancesAtCutoff) {
    if (!atCutoff.greaterThan(0)) continue;
    const atEnd = balancesAtEnd.get(partyId) ?? ZERO;
    if (!atEnd.greaterThan(0)) continue;
    agedLoss = agedLoss.add(
      atCutoff.lessThan(atEnd) ? atCutoff : atEnd
    );
  }

  return {
    revenue,
    cogs,
    spoilage,
    grossProfit,
    expensesByCategory,
    totalExpenses,
    agedLoss,
    netProfit: grossProfit.sub(totalExpenses).sub(agedLoss),
  };
}

export type BalanceSheet = {
  stockRows: { fishType: string; qty: Prisma.Decimal; value: Prisma.Decimal }[];
  stockValue: Prisma.Decimal;
  receivables: Prisma.Decimal;
  agedReceivables: Prisma.Decimal;
  ownerReserve: Prisma.Decimal;
  payables: Prisma.Decimal;
  netPosition: Prisma.Decimal;
};

/** Snapshot as of a date: stock at weighted-average cost, receivables/payables, reserve. */
export async function computeBalanceSheet(
  companyId: string,
  asOf: Date
): Promise<BalanceSheet> {
  const [moves, avgCost, balances, reserveLast] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ["fishType", "state", "direction"],
      where: {
        companyId,
        date: { lte: asOf },
        state: { in: ["AVAILABLE", "IN_TRANSIT"] },
      },
      _sum: { qtyKg: true },
    }),
    getAvgCostMap(companyId, asOf),
    getBalancesAsOf(companyId, asOf),
    prisma.ownerReserveEntry.findFirst({
      where: { companyId, date: { lte: asOf } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { runningBalance: true },
    }),
  ]);

  const qtyByFish = new Map<string, Prisma.Decimal>();
  for (const m of moves) {
    const sum = m._sum.qtyKg ?? ZERO;
    const prev = qtyByFish.get(m.fishType) ?? ZERO;
    qtyByFish.set(
      m.fishType,
      m.direction === "IN" ? prev.add(sum) : prev.sub(sum)
    );
  }
  const stockRows = [...qtyByFish.entries()]
    .filter(([, qty]) => qty.greaterThan(0))
    .map(([fishType, qty]) => ({
      fishType,
      qty,
      value: qty.mul(avgCost.get(fishType) ?? ZERO),
    }))
    .sort((a, b) => a.fishType.localeCompare(b.fishType));
  const stockValue = stockRows.reduce((acc, r) => acc.add(r.value), ZERO);

  let receivables = ZERO;
  let payables = ZERO;
  for (const bal of balances.values()) {
    if (bal.greaterThan(0)) receivables = receivables.add(bal);
    else payables = payables.add(bal.abs());
  }

  // Aged portion of receivables — flagged because the P&L treats it as loss.
  const cutoff = new Date(asOf.getTime() - AGED_LOSS_DAYS * 86_400_000);
  const atCutoff = await getBalancesAsOf(companyId, cutoff);
  let agedReceivables = ZERO;
  for (const [partyId, cutBal] of atCutoff) {
    if (!cutBal.greaterThan(0)) continue;
    const now = balances.get(partyId) ?? ZERO;
    if (!now.greaterThan(0)) continue;
    agedReceivables = agedReceivables.add(
      cutBal.lessThan(now) ? cutBal : now
    );
  }

  const ownerReserve = reserveLast?.runningBalance ?? ZERO;
  return {
    stockRows,
    stockValue,
    receivables,
    agedReceivables,
    ownerReserve,
    payables,
    netPosition: stockValue.add(receivables).add(ownerReserve).sub(payables),
  };
}
