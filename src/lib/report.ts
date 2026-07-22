import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  DeliveryChannel,
  ExpenseCategory,
  PurchaseType,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getFlaggedIds } from "@/lib/errorflag";

const ZERO = new Prisma.Decimal(0);

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

export type ProfitReport = {
  sale: Prisma.Decimal;
  purchase: Prisma.Decimal;
  expense: Prisma.Decimal;
  profit: Prisma.Decimal; // sale − (purchase + expense)
  purchaseByType: { type: PurchaseType; amount: Prisma.Decimal }[];
  expenseByCategory: { category: ExpenseCategory; amount: Prisma.Decimal }[];
  saleByChannel: { channel: DeliveryChannel; amount: Prisma.Decimal }[];
};

/**
 * Profit for [from, to]: recognised sale totals minus recognised purchase and
 * expense totals. Deliberately ignores payment status (paid/unpaid,
 * received/outstanding) everywhere — that only moves a party's outstanding
 * balance, never the profit. Flagged-error vouchers stay visible in lists but
 * never count in totals.
 */
export async function computeProfit(
  companyId: string,
  from: Date,
  to: Date
): Promise<ProfitReport> {
  const dateRange = { gte: from, lte: to };
  const [flaggedPurchases, flaggedExpenses, flaggedSettlements, flaggedDeliveries] =
    await Promise.all([
      getFlaggedIds("PURCHASE"),
      getFlaggedIds("EXPENSE"),
      getFlaggedIds("SETTLEMENT"),
      getFlaggedIds("DELIVERY_NOTE"),
    ]);

  const [purchaseGroups, expenseGroups, settlements] = await Promise.all([
    prisma.purchase.groupBy({
      by: ["type"],
      where: { companyId, date: dateRange, id: { notIn: flaggedPurchases } },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["category"],
      where: { companyId, date: dateRange, id: { notIn: flaggedExpenses } },
      _sum: { amount: true },
    }),
    prisma.settlement.findMany({
      where: {
        date: dateRange,
        id: { notIn: flaggedSettlements },
        deliveryNote: { companyId, id: { notIn: flaggedDeliveries } },
      },
      include: { deliveryNote: { select: { channel: true } } },
    }),
  ]);

  const purchaseByType = purchaseGroups
    .map((g) => ({ type: g.type, amount: g._sum.amount ?? ZERO }))
    .sort((a, b) => a.type.localeCompare(b.type));
  const purchase = purchaseByType.reduce((a, r) => a.add(r.amount), ZERO);

  const expenseByCategory = expenseGroups
    .map((g) => ({ category: g.category, amount: g._sum.amount ?? ZERO }))
    .sort((a, b) => a.category.localeCompare(b.category));
  const expense = expenseByCategory.reduce((a, r) => a.add(r.amount), ZERO);

  const channelMap = new Map<DeliveryChannel, Prisma.Decimal>();
  let sale = ZERO;
  for (const s of settlements) {
    sale = sale.add(s.amount);
    const ch = s.deliveryNote.channel;
    channelMap.set(ch, (channelMap.get(ch) ?? ZERO).add(s.amount));
  }
  const saleByChannel = [...channelMap.entries()]
    .map(([channel, amount]) => ({ channel, amount }))
    .sort((a, b) => a.channel.localeCompare(b.channel));

  return {
    sale,
    purchase,
    expense,
    profit: sale.sub(purchase).sub(expense),
    purchaseByType,
    expenseByCategory,
    saleByChannel,
  };
}

/** One day's figures — powers the Day Book screen and dashboard tiles. */
export function computeDayBook(companyId: string, date: Date) {
  return computeProfit(companyId, date, date);
}
