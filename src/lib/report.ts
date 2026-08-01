import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  SaleType,
  ExpenseCategory,
  PurchaseType,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getFlaggedIds } from "@/lib/errorflag";

const ZERO = new Prisma.Decimal(0);

/**
 * Each party's running balance as of a date within one centre (parties without
 * entries omitted). Ledgers are isolated per centre, so callers must pass the
 * centre they want balances for.
 */
export async function getBalancesAsOf(
  companyId: string,
  centreId: string,
  asOf: Date
): Promise<Map<string, Prisma.Decimal>> {
  const latest = await prisma.ledgerEntry.findMany({
    where: { companyId, centreId, date: { lte: asOf } },
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
  saleByType: { type: SaleType; amount: Prisma.Decimal }[];
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
  const [flaggedPurchases, flaggedExpenses, flaggedSales] = await Promise.all([
    getFlaggedIds("PURCHASE"),
    getFlaggedIds("EXPENSE"),
    getFlaggedIds("SALE"),
  ]);

  const [purchaseGroups, expenseGroups, saleGroups] = await Promise.all([
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
    prisma.sale.groupBy({
      by: ["type"],
      where: { companyId, date: dateRange, id: { notIn: flaggedSales } },
      _sum: { amount: true },
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

  const saleByType = saleGroups
    .map((g) => ({ type: g.type, amount: g._sum.amount ?? ZERO }))
    .sort((a, b) => a.type.localeCompare(b.type));
  const sale = saleByType.reduce((a, r) => a.add(r.amount), ZERO);

  return {
    sale,
    purchase,
    expense,
    profit: sale.sub(purchase).sub(expense),
    purchaseByType,
    expenseByCategory,
    saleByType,
  };
}

/** One day's figures — powers the Day Book screen and dashboard tiles. */
export function computeDayBook(companyId: string, date: Date) {
  return computeProfit(companyId, date, date);
}

export type UnionCentre = {
  centreId: string;
  centreName: string;
  sale: Prisma.Decimal;
  purchase: Prisma.Decimal;
  expense: Prisma.Decimal;
};

export type UnionCompany = {
  companyId: string;
  companyName: string;
  sale: Prisma.Decimal;
  purchase: Prisma.Decimal;
  expense: Prisma.Decimal;
  profit: Prisma.Decimal;
  centres: UnionCentre[];
};

export type UnionReport = {
  total: {
    sale: Prisma.Decimal;
    purchase: Prisma.Decimal;
    expense: Prisma.Decimal;
    profit: Prisma.Decimal;
  };
  companies: UnionCompany[];
};

/**
 * Union view: P/L for every company (summed over its centres) plus per-centre
 * Sale/Purchase/Expense figures, and a grand total across everything, for the
 * range [from, to]. Flagged rows are excluded. Centre-level profit is
 * deliberately not reported — only the raw three figures — because purchase and
 * sale are split across centres, so per-centre profit is not meaningful.
 */
export async function computeUnion(from: Date, to: Date): Promise<UnionReport> {
  const dateRange = { gte: from, lte: to };
  const [companies, centres, flaggedPurchases, flaggedExpenses, flaggedSales] =
    await Promise.all([
      prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.centre.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, companyId: true } }),
      getFlaggedIds("PURCHASE"),
      getFlaggedIds("EXPENSE"),
      getFlaggedIds("SALE"),
    ]);

  const [purchaseGroups, saleGroups, expenseGroups] = await Promise.all([
    prisma.purchase.groupBy({
      by: ["centreId"],
      where: { date: dateRange, id: { notIn: flaggedPurchases } },
      _sum: { amount: true },
    }),
    prisma.sale.groupBy({
      by: ["centreId"],
      where: { date: dateRange, id: { notIn: flaggedSales } },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["centreId"],
      where: { date: dateRange, id: { notIn: flaggedExpenses } },
      _sum: { amount: true },
    }),
  ]);

  const purchaseByCentre = new Map(purchaseGroups.map((g) => [g.centreId, g._sum.amount ?? ZERO]));
  const saleByCentre = new Map(saleGroups.map((g) => [g.centreId, g._sum.amount ?? ZERO]));
  const expenseByCentre = new Map(expenseGroups.map((g) => [g.centreId, g._sum.amount ?? ZERO]));

  let tSale = ZERO;
  let tPurchase = ZERO;
  let tExpense = ZERO;

  const unionCompanies: UnionCompany[] = companies.map((c) => {
    const own = centres.filter((ce) => ce.companyId === c.id);
    let sale = ZERO;
    let purchase = ZERO;
    let expense = ZERO;
    const unionCentres: UnionCentre[] = own.map((ce) => {
      const s = saleByCentre.get(ce.id) ?? ZERO;
      const p = purchaseByCentre.get(ce.id) ?? ZERO;
      const e = expenseByCentre.get(ce.id) ?? ZERO;
      sale = sale.add(s);
      purchase = purchase.add(p);
      expense = expense.add(e);
      return { centreId: ce.id, centreName: ce.name, sale: s, purchase: p, expense: e };
    });
    tSale = tSale.add(sale);
    tPurchase = tPurchase.add(purchase);
    tExpense = tExpense.add(expense);
    return {
      companyId: c.id,
      companyName: c.name,
      sale,
      purchase,
      expense,
      profit: sale.sub(purchase).sub(expense),
      centres: unionCentres,
    };
  });

  return {
    total: {
      sale: tSale,
      purchase: tPurchase,
      expense: tExpense,
      profit: tSale.sub(tPurchase).sub(tExpense),
    },
    companies: unionCompanies,
  };
}

// ---------------------------------------------------------------------------
// Period breakdown — the Day / Month / Year report
// ---------------------------------------------------------------------------

export type PeriodBucket = {
  /** "YYYY-MM-DD" for day buckets, "YYYY-MM" for month buckets. */
  key: string;
  /** Column label: "1".."31" for days, "Jan".."Dec" for months. */
  label: string;
  purchaseByType: Record<PurchaseType, Prisma.Decimal>;
  saleByType: Record<SaleType, Prisma.Decimal>;
  expenseByCategory: Record<ExpenseCategory, Prisma.Decimal>;
  purchase: Prisma.Decimal;
  sale: Prisma.Decimal;
  expense: Prisma.Decimal;
  profit: Prisma.Decimal;
};

export type PeriodBreakdown = {
  buckets: PeriodBucket[];
  total: PeriodBucket;
};

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function emptyBucket(key: string, label: string): PeriodBucket {
  return {
    key,
    label,
    purchaseByType: { SOCIETY: ZERO, KFDC: ZERO, PRIVATE: ZERO, LOCAL: ZERO },
    saleByType: { MARKET: ZERO, FISH_MILL: ZERO, FACTORY: ZERO, LOCAL: ZERO },
    expenseByCategory: {
      ICE: ZERO, LOADERS: ZERO, LADIES: ZERO,
      BATHA: ZERO, CANTEEN: ZERO, RENT: ZERO,
    },
    purchase: ZERO,
    sale: ZERO,
    expense: ZERO,
    profit: ZERO,
  };
}

/**
 * A @db.Date comes back as UTC midnight, so slicing the ISO string is what
 * preserves the calendar day — the same reasoning as toInputDate() in format.ts.
 * Never use local getDate()/getMonth() here; they would shift the day for any
 * server not running in UTC.
 */
function bucketKeyOf(date: Date, bucket: "day" | "month"): string {
  const iso = date.toISOString();
  return bucket === "day" ? iso.slice(0, 10) : iso.slice(0, 7);
}

/**
 * Purchase / sale / expense totals for [from, to], split by calendar day or by
 * calendar month, and within each of those by voucher type or expense category.
 *
 * Grouping happens in Postgres — three groupBy queries, one per voucher table,
 * keyed on (date, type) — so the cost is set by how many distinct day/type
 * combinations exist in the range, not by how many vouchers were written. A
 * full year is at most a few thousand grouped rows.
 *
 * Empty buckets are materialised deliberately: the report is meant to show
 * every day of the month including the ones with no trade, so a quiet day reads
 * as a zero rather than vanishing from the table.
 *
 * Flagged-error vouchers are excluded, matching computeProfit() so the two
 * screens can never disagree.
 */
export async function computePeriodBreakdown(args: {
  companyId: string;
  /** null = every centre of the company. */
  centreId: string | null;
  from: Date;
  to: Date;
  bucket: "day" | "month";
}): Promise<PeriodBreakdown> {
  const { companyId, centreId, from, to, bucket } = args;
  const scope = {
    companyId,
    ...(centreId ? { centreId } : {}),
    date: { gte: from, lte: to },
  };

  const [flaggedPurchases, flaggedExpenses, flaggedSales] = await Promise.all([
    getFlaggedIds("PURCHASE"),
    getFlaggedIds("EXPENSE"),
    getFlaggedIds("SALE"),
  ]);

  const [purchaseGroups, saleGroups, expenseGroups] = await Promise.all([
    prisma.purchase.groupBy({
      by: ["date", "type"],
      where: { ...scope, id: { notIn: flaggedPurchases } },
      _sum: { amount: true },
    }),
    prisma.sale.groupBy({
      by: ["date", "type"],
      where: { ...scope, id: { notIn: flaggedSales } },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["date", "category"],
      where: { ...scope, id: { notIn: flaggedExpenses } },
      _sum: { amount: true },
    }),
  ]);

  // Pre-seed every bucket in the range so gaps render as zero rows.
  const buckets = new Map<string, PeriodBucket>();
  if (bucket === "day") {
    for (
      let t = from.getTime();
      t <= to.getTime();
      t += 24 * 60 * 60 * 1000
    ) {
      const d = new Date(t);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, emptyBucket(key, String(d.getUTCDate())));
    }
  } else {
    const y = from.getUTCFullYear();
    for (let m = 0; m < 12; m++) {
      const key = `${y}-${String(m + 1).padStart(2, "0")}`;
      buckets.set(key, emptyBucket(key, MONTH_LABELS[m]));
    }
  }

  const total = emptyBucket("total", "Total");

  for (const g of purchaseGroups) {
    const b = buckets.get(bucketKeyOf(g.date, bucket));
    if (!b) continue;
    const amount = g._sum.amount ?? ZERO;
    b.purchaseByType[g.type] = b.purchaseByType[g.type].add(amount);
    b.purchase = b.purchase.add(amount);
    total.purchaseByType[g.type] = total.purchaseByType[g.type].add(amount);
    total.purchase = total.purchase.add(amount);
  }

  for (const g of saleGroups) {
    const b = buckets.get(bucketKeyOf(g.date, bucket));
    if (!b) continue;
    const amount = g._sum.amount ?? ZERO;
    b.saleByType[g.type] = b.saleByType[g.type].add(amount);
    b.sale = b.sale.add(amount);
    total.saleByType[g.type] = total.saleByType[g.type].add(amount);
    total.sale = total.sale.add(amount);
  }

  for (const g of expenseGroups) {
    const b = buckets.get(bucketKeyOf(g.date, bucket));
    if (!b) continue;
    const amount = g._sum.amount ?? ZERO;
    b.expenseByCategory[g.category] =
      b.expenseByCategory[g.category].add(amount);
    b.expense = b.expense.add(amount);
    total.expenseByCategory[g.category] =
      total.expenseByCategory[g.category].add(amount);
    total.expense = total.expense.add(amount);
  }

  for (const b of buckets.values()) {
    b.profit = b.sale.sub(b.purchase).sub(b.expense);
  }
  total.profit = total.sale.sub(total.purchase).sub(total.expense);

  return { buckets: [...buckets.values()], total };
}

export type RegisterRow = {
  id: string;
  date: Date;
  createdAt: Date;
  centreName: string;
  kind: "PURCHASE" | "SALE" | "EXPENSE";
  subtype: string; // PurchaseType | SaleType | ExpenseCategory enum value
  partyName: string;
  amount: Prisma.Decimal;
  href: string;
};

/**
 * The transactions register for [from, to] — every purchase, sale and expense
 * in one chronological list. Flagged rows are excluded so the register matches
 * the P/L totals.
 *
 * `centreId` narrows it to a single centre; null keeps the original
 * company-wide behaviour, which is the honest scope for anything that reports
 * profit (purchase and sale of the same fish can land in different centres).
 */
export async function getTransactionRegister(
  companyId: string,
  from: Date,
  to: Date,
  centreId: string | null = null
): Promise<RegisterRow[]> {
  const dateRange = { gte: from, lte: to };
  const centreWhere = centreId ? { centreId } : {};
  const [flaggedPurchases, flaggedExpenses, flaggedSales] = await Promise.all([
    getFlaggedIds("PURCHASE"),
    getFlaggedIds("EXPENSE"),
    getFlaggedIds("SALE"),
  ]);

  const [purchases, sales, expenses] = await Promise.all([
    prisma.purchase.findMany({
      where: {
        companyId,
        ...centreWhere,
        date: dateRange,
        id: { notIn: flaggedPurchases },
      },
      include: { centre: { select: { name: true } }, party: { select: { name: true } } },
    }),
    prisma.sale.findMany({
      where: {
        companyId,
        ...centreWhere,
        date: dateRange,
        id: { notIn: flaggedSales },
      },
      include: {
        centre: { select: { name: true } },
        party: { select: { name: true } },
        careOfParty: { select: { name: true } },
      },
    }),
    prisma.expense.findMany({
      where: {
        companyId,
        ...centreWhere,
        date: dateRange,
        id: { notIn: flaggedExpenses },
      },
      include: { centre: { select: { name: true } }, party: { select: { name: true } } },
    }),
  ]);

  const rows: RegisterRow[] = [
    ...purchases.map((p) => ({
      id: p.id,
      date: p.date,
      createdAt: p.createdAt,
      centreName: p.centre.name,
      kind: "PURCHASE" as const,
      subtype: p.type,
      partyName: p.party.name,
      amount: p.amount,
      href: `/vouchers/purchases/${p.id}`,
    })),
    ...sales.map((s) => ({
      id: s.id,
      date: s.date,
      createdAt: s.createdAt,
      centreName: s.centre.name,
      kind: "SALE" as const,
      subtype: s.type,
      partyName: s.careOfParty
        ? `${s.party.name} (c/o ${s.careOfParty.name})`
        : s.party.name,
      amount: s.amount,
      href: `/vouchers/sales/${s.id}`,
    })),
    ...expenses.map((e) => ({
      id: e.id,
      date: e.date,
      createdAt: e.createdAt,
      centreName: e.centre.name,
      kind: "EXPENSE" as const,
      subtype: e.category,
      partyName: e.party.name,
      amount: e.amount,
      href: `/vouchers/expenses/${e.id}`,
    })),
  ];

  rows.sort((a, b) => {
    const d = a.date.getTime() - b.date.getTime();
    return d !== 0 ? d : a.createdAt.getTime() - b.createdAt.getTime();
  });
  return rows;
}
