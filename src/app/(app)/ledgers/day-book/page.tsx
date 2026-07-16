import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { fmtMoney, toInputDate } from "@/lib/format";

const ZERO = new Prisma.Decimal(0);

async function computeDayBook(companyId: string, date: Date) {
  const [purchaseAgg, expenseGroups, settlements, directSaleAgg, soldMoves, lossMoves, purchaseCost] =
    await Promise.all([
      prisma.purchase.aggregate({
        where: { companyId, date },
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ["category"],
        where: { companyId, date },
        _sum: { amount: true },
      }),
      prisma.settlement.findMany({
        where: { date, deliveryNote: { companyId } },
        include: { deliveryNote: { select: { rate: true } } },
      }),
      prisma.directSale.aggregate({
        where: { companyId, date },
        _sum: { amount: true },
      }),
      prisma.stockMovement.groupBy({
        by: ["fishType"],
        where: { companyId, date, state: "SOLD", direction: "IN" },
        _sum: { qtyKg: true },
      }),
      prisma.stockMovement.groupBy({
        by: ["fishType"],
        where: { companyId, date, state: "LOSS", direction: "IN" },
        _sum: { qtyKg: true },
      }),
      // Weighted average purchase cost per fish type, up to this date.
      prisma.purchase.groupBy({
        by: ["fishType"],
        where: { companyId, date: { lte: date } },
        _sum: { amount: true, qtyKg: true },
      }),
    ]);

  const purchase = purchaseAgg._sum.amount ?? ZERO;

  let rent = ZERO;
  let expenses = ZERO;
  for (const g of expenseGroups) {
    const sum = g._sum.amount ?? ZERO;
    if (g.category === "RENT") rent = rent.add(sum);
    else expenses = expenses.add(sum);
  }

  // Cash view: what actually came in today.
  const cashSale = settlements
    .reduce((acc, s) => acc.add(s.amountReceived), ZERO)
    .add(directSaleAgg._sum.amount ?? ZERO);
  const cashPf = cashSale.sub(purchase).sub(expenses).sub(rent);

  // Accrual view: value earned today at locked rates (variance debt is
  // still revenue receivable), matched against the cost of what was sold.
  const accrualRevenue = settlements
    .reduce((acc, s) => acc.add(s.qtyAccepted.mul(s.deliveryNote.rate)), ZERO)
    .add(directSaleAgg._sum.amount ?? ZERO);

  const avgCost = new Map<string, Prisma.Decimal>();
  for (const g of purchaseCost) {
    const qty = g._sum.qtyKg ?? ZERO;
    if (qty.greaterThan(0)) {
      avgCost.set(g.fishType, (g._sum.amount ?? ZERO).div(qty));
    }
  }
  const costOf = (groups: typeof soldMoves) =>
    groups.reduce((acc, g) => {
      const cost = avgCost.get(g.fishType);
      return cost ? acc.add((g._sum.qtyKg ?? ZERO).mul(cost)) : acc;
    }, ZERO);
  const cogs = costOf(soldMoves);
  const spoilage = costOf(lossMoves);

  const truePf = accrualRevenue.sub(cogs).sub(spoilage).sub(expenses).sub(rent);

  return { purchase, expenses, rent, cashSale, cashPf, accrualRevenue, cogs, spoilage, truePf };
}

export default async function DayBookPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireSession();
  const company = await getActiveCompany();

  const raw = (await searchParams).date;
  const date =
    raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(raw)
      : new Date(toInputDate(new Date()));

  const d = await computeDayBook(company.id, date);
  const pfCls = (v: Prisma.Decimal) =>
    v.greaterThan(0) ? "text-credit" : v.lessThan(0) ? "text-debit" : "";

  return (
    <div className="max-w-3xl">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Day Book</h1>
          <p className="text-muted text-[13px]">{company.name}</p>
        </div>
        <form method="GET" className="flex items-center gap-2">
          <label
            htmlFor="date"
            className="text-[12px] uppercase tracking-wide text-muted font-semibold"
          >
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={toInputDate(date)}
            className="border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="bg-accent text-white px-3 py-1.5 text-[13px] font-semibold"
          >
            Show
          </button>
        </form>
      </div>

      {/* The familiar daily row — cash snapshot, primary (design doc #7) */}
      <div className="border border-line-strong bg-surface">
        <table className="ledger-table">
          <thead>
            <tr>
              <th className="num-col">
                <Link href="/vouchers/purchases" className="hover:underline">
                  Purchase
                </Link>
              </th>
              <th className="num-col">
                <Link href="/ledgers/expenses" className="hover:underline">
                  Expenses
                </Link>
              </th>
              <th className="num-col">
                <Link href="/ledgers/expenses/rent" className="hover:underline">
                  Rent
                </Link>
              </th>
              <th className="num-col">Sale</th>
              <th className="num-col">P/F</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-[15px]">
              <td className="num-col num font-semibold text-debit">
                {fmtMoney(d.purchase)}
              </td>
              <td className="num-col num font-semibold text-debit">
                {fmtMoney(d.expenses)}
              </td>
              <td className="num-col num font-semibold text-debit">
                {fmtMoney(d.rent)}
              </td>
              <td className="num-col num font-semibold text-credit">
                {fmtMoney(d.cashSale)}
              </td>
              <td className={`num-col num font-bold ${pfCls(d.cashPf)}`}>
                {fmtMoney(d.cashPf)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="px-4 py-2 text-[12px] text-muted border-t border-line">
          Cash snapshot: money received today minus money spent today. Stock
          bought today but not yet sold makes this look worse than reality.
        </p>
      </div>

      {/* Secondary, visually distinct: the accrual-accurate figure */}
      <div className="border border-line bg-background mt-3 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">
            True profit (COGS-matched)
            <span className="text-muted font-normal">
              {" "}
              — value sold today minus what that stock cost, spoilage and the
              day&apos;s expenses
            </span>
          </span>
          <span className={`num text-lg font-bold ${pfCls(d.truePf)}`}>
            {fmtMoney(d.truePf)}
          </span>
        </div>
        <div className="mt-2 text-[12px] text-muted num flex gap-5 flex-wrap">
          <span>Revenue earned {fmtMoney(d.accrualRevenue)}</span>
          <span>− cost of goods sold {fmtMoney(d.cogs)}</span>
          <span>− spoilage {fmtMoney(d.spoilage)}</span>
          <span>− expenses &amp; rent {fmtMoney(d.expenses.add(d.rent))}</span>
        </div>
      </div>
    </div>
  );
}
