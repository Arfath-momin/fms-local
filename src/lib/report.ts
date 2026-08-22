import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  ExpenseKind,
  SaleType,
  PurchaseType,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

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
    orderBy: [{ date: "desc" }, { seq: "desc" }],
    distinct: ["partyId"],
    select: { partyId: true, runningBalance: true },
  });
  return new Map(latest.map((e) => [e.partyId, e.runningBalance]));
}

export type ExpenseCategoryTotal = {
  categoryId: string;
  code: string;
  name: string;
  kind: ExpenseKind;
  amount: Prisma.Decimal;
};

export type ProfitReport = {
  sale: Prisma.Decimal;
  purchase: Prisma.Decimal;
  /** Every expense in the range, both tiers. Kept for list screens. */
  expense: Prisma.Decimal;
  /** Ice, loaders, ladies, batha, canteen, vehicle rent — cost of the catch. */
  directExpense: Prisma.Decimal;
  /** Salaries, office rent, electricity — cost of the month, not the catch. */
  overheadExpense: Prisma.Decimal;
  /** sale − purchase − directExpense. The per-buying-day figure. */
  grossProfit: Prisma.Decimal;
  /** grossProfit − overheadExpense. The per-month figure, before reserve. */
  netProfit: Prisma.Decimal;
  purchaseByType: { type: PurchaseType; amount: Prisma.Decimal }[];
  expenseByCategory: ExpenseCategoryTotal[];
  saleByType: { type: SaleType; amount: Prisma.Decimal }[];
};

/**
 * Profit for [from, to]: recognised sale totals minus recognised purchase and
 * expense totals. Deliberately ignores payment status (paid/unpaid,
 * received/outstanding) everywhere — that only moves a party's outstanding
 * balance, never the profit. Flagged-error vouchers stay visible in lists but
 * never count in totals.
 *
 * `centreId` scopes the figures to one centre; null aggregates every centre of
 * the company. Callers that display a centre-scoped screen must pass the
 * centre, or the totals will silently include trade from centres the user is
 * not looking at. Note that a centre-scoped profit can look wrong when fish is
 * bought in one centre and sold from another — the Union screen is the
 * cross-centre view for that.
 */
export async function computeProfit(
  companyId: string,
  centreId: string | null,
  from: Date,
  to: Date
): Promise<ProfitReport> {
  const dateRange = { gte: from, lte: to };
  const centreWhere = centreId ? { centreId } : {};

  const [purchaseGroups, expenseGroups, saleGroups] = await Promise.all([
    prisma.purchase.groupBy({
      by: ["type"],
      where: {
        companyId,
        ...centreWhere,
        date: dateRange,
      },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["categoryId"],
      where: {
        companyId,
        ...centreWhere,
        date: dateRange,
      },
      _sum: { amount: true },
    }),
    prisma.sale.groupBy({
      by: ["type"],
      where: {
        companyId,
        ...centreWhere,
        date: dateRange,
      },
      // rentDeducted comes back with the amount because market revenue is
      // `net bill + rent deducted` (spec §2). It is null on every non-market
      // bill, so summing it unconditionally adds nothing there.
      _sum: { amount: true, rentDeducted: true },
    }),
  ]);

  const purchaseByType = purchaseGroups
    .map((g) => ({ type: g.type, amount: g._sum.amount ?? ZERO }))
    .sort((a, b) => a.type.localeCompare(b.type));
  const purchase = purchaseByType.reduce((a, r) => a.add(r.amount), ZERO);

  // Categories are rows now, so their names and — crucially — their DIRECT /
  // OVERHEAD kind have to be resolved. One query over the ids in the result,
  // never one per group.
  const categories = await prisma.expenseCategory.findMany({
    where: { id: { in: expenseGroups.map((g) => g.categoryId) } },
    select: { id: true, code: true, name: true, kind: true, sortOrder: true },
  });
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const expenseByCategory: ExpenseCategoryTotal[] = expenseGroups
    .map((g) => {
      const c = categoryById.get(g.categoryId);
      return {
        categoryId: g.categoryId,
        code: c?.code ?? "UNKNOWN",
        name: c?.name ?? "Unknown",
        // An expense whose category row has vanished is counted as DIRECT
        // rather than dropped: losing it entirely would overstate profit, and
        // overstating profit is the failure that matters here.
        kind: c?.kind ?? ("DIRECT" as ExpenseKind),
        amount: g._sum.amount ?? ZERO,
      };
    })
    .sort(
      (a, b) =>
        (categoryById.get(a.categoryId)?.sortOrder ?? 0) -
          (categoryById.get(b.categoryId)?.sortOrder ?? 0) ||
        a.code.localeCompare(b.code)
    );

  const expense = expenseByCategory.reduce((a, r) => a.add(r.amount), ZERO);
  const directExpense = expenseByCategory
    .filter((r) => r.kind === "DIRECT")
    .reduce((a, r) => a.add(r.amount), ZERO);
  const overheadExpense = expenseByCategory
    .filter((r) => r.kind === "OVERHEAD")
    .reduce((a, r) => a.add(r.amount), ZERO);

  // Revenue, not the bill total: the market rent is grossed back up here,
  // because that money left the business through the transporter's account and
  // is already carried as a cost on the trip. Leaving it out would understate
  // the day twice over.
  const saleByType = saleGroups
    .map((g) => ({
      type: g.type,
      amount: (g._sum.amount ?? ZERO).add(g._sum.rentDeducted ?? ZERO),
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
  const sale = saleByType.reduce((a, r) => a.add(r.amount), ZERO);

  // Two tiers, per spec §2. Gross belongs to a buying day and must never carry
  // an overhead: a salary is not a cost of Tuesday's catch, and charging it
  // there makes the daily figure meaningless. Net is the monthly view.
  const grossProfit = sale.sub(purchase).sub(directExpense);

  return {
    sale,
    purchase,
    expense,
    directExpense,
    overheadExpense,
    grossProfit,
    netProfit: grossProfit.sub(overheadExpense),
    purchaseByType,
    expenseByCategory,
    saleByType,
  };
}

/** One day's figures — powers the Day Book screen and dashboard tiles. */
export function computeDayBook(
  companyId: string,
  centreId: string | null,
  date: Date
) {
  return computeProfit(companyId, centreId, date, date);
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
 * Union view: P/L for a company (summed over its centres) plus per-centre
 * Sale/Purchase/Expense figures, and a total, for the range [from, to]. Flagged
 * rows are excluded. Centre-level profit is deliberately not reported — only the
 * raw three figures — because purchase and sale are split across centres, so
 * per-centre profit is not meaningful.
 *
 * `companyId` narrows the whole report to one company; null keeps every
 * company. The screen always passes one, because BFM's figures and B2B's are
 * separate businesses and a total across both answers nobody's question. The
 * filter goes into the queries rather than being applied afterwards, so the
 * other company's rows never leave Postgres.
 */
export async function computeUnion(
  from: Date,
  to: Date,
  companyId: string | null = null
): Promise<UnionReport> {
  const dateRange = { gte: from, lte: to };
  const companyWhere = companyId ? { companyId } : {};
  const [companies, centres] =
    await Promise.all([
      prisma.company.findMany({
        where: companyId ? { id: companyId } : {},
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.centre.findMany({
        where: companyWhere,
        orderBy: { name: "asc" },
        select: { id: true, name: true, companyId: true },
      }),
    ]);

  const [purchaseGroups, saleGroups, expenseGroups] = await Promise.all([
    prisma.purchase.groupBy({
      by: ["centreId"],
      where: { ...companyWhere, date: dateRange },
      _sum: { amount: true },
    }),
    prisma.sale.groupBy({
      by: ["centreId"],
      where: { ...companyWhere, date: dateRange },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["centreId"],
      where: { ...companyWhere, date: dateRange },
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
  /// Keyed by category ID, because categories are rows now and the set is no
  /// longer knowable at compile time. Labels come from `categories` on the
  /// result, so a bucket carries figures and the caller carries names.
  expenseByCategory: Record<string, Prisma.Decimal>;
  purchase: Prisma.Decimal;
  sale: Prisma.Decimal;
  /** Every expense in the bucket, both tiers. */
  expense: Prisma.Decimal;
  /** Direct costs only — what a buying day's gross profit is charged. */
  directExpense: Prisma.Decimal;
  overheadExpense: Prisma.Decimal;
  /** sale − purchase − directExpense. Overheads never touch this. */
  grossProfit: Prisma.Decimal;
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
    // Starts empty and fills as groups arrive — the category set is data, so
    // there is nothing to pre-seed. Readers use `?? ZERO`.
    expenseByCategory: {},
    purchase: ZERO,
    sale: ZERO,
    expense: ZERO,
    directExpense: ZERO,
    overheadExpense: ZERO,
    grossProfit: ZERO,
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

  const [purchaseGroups, saleGroups, expenseGroups] = await Promise.all([
    prisma.purchase.groupBy({
      by: ["date", "type"],
      where: { ...scope },
      _sum: { amount: true },
    }),
    prisma.sale.groupBy({
      by: ["date", "type"],
      where: { ...scope },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["date", "categoryId"],
      where: { ...scope },
      _sum: { amount: true },
    }),
  ]);

  // One lookup of the categories present, so each bucket can split its spend
  // into the two tiers. An unknown category counts as DIRECT: dropping it
  // would overstate profit, which is the failure that matters.
  const kindById = new Map(
    (
      await prisma.expenseCategory.findMany({
        where: { id: { in: expenseGroups.map((g) => g.categoryId) } },
        select: { id: true, kind: true },
      })
    ).map((c) => [c.id, c.kind])
  );

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
    b.expenseByCategory[g.categoryId] = (
      b.expenseByCategory[g.categoryId] ?? ZERO
    ).add(amount);
    b.expense = b.expense.add(amount);
    total.expenseByCategory[g.categoryId] = (
      total.expenseByCategory[g.categoryId] ?? ZERO
    ).add(amount);
    total.expense = total.expense.add(amount);

    // Split by tier as we go. A salary is not a cost of Tuesday's catch, so it
    // must not reach Tuesday's gross figure (spec §2).
    const direct = kindById.get(g.categoryId) !== "OVERHEAD";
    if (direct) {
      b.directExpense = b.directExpense.add(amount);
      total.directExpense = total.directExpense.add(amount);
    } else {
      b.overheadExpense = b.overheadExpense.add(amount);
      total.overheadExpense = total.overheadExpense.add(amount);
    }
  }

  for (const b of buckets.values()) {
    b.grossProfit = b.sale.sub(b.purchase).sub(b.directExpense);
  }
  total.grossProfit = total.sale
    .sub(total.purchase)
    .sub(total.directExpense);

  return { buckets: [...buckets.values()], total };
}

export type RegisterKind =
  | "PURCHASE"
  | "SALE"
  | "EXPENSE"
  | "PAYMENT"
  | "RECEIPT";

/**
 * PAYMENT and RECEIPT are money moving, not trade. They belong in the register
 * — they are transactions the user entered and expects to see — but they must
 * never reach the profit calculation, or settling a purchase would show up as
 * a second cost. Callers total them in their own columns; see
 * `isProfitKind()`.
 */
export const isProfitKind = (kind: RegisterKind): boolean =>
  kind === "PURCHASE" || kind === "SALE" || kind === "EXPENSE";

export type RegisterRow = {
  id: string;
  date: Date;
  createdAt: Date;
  centreName: string;
  kind: RegisterKind;
  /** PurchaseType | SaleType | ExpenseCategory | SettlementMode. */
  subtype: string;
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

  const [purchases, sales, expenses, settlements] = await Promise.all([
    prisma.purchase.findMany({
      where: {
        companyId,
        ...centreWhere,
        date: dateRange,
      },
      include: { centre: { select: { name: true } }, party: { select: { name: true } } },
    }),
    prisma.sale.findMany({
      where: {
        companyId,
        ...centreWhere,
        date: dateRange,
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
      },
      include: {
        centre: { select: { name: true } },
        party: { select: { name: true } },
        // The register names the category, which is a row now.
        category: { select: { code: true, name: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { companyId, ...centreWhere, date: dateRange },
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
      subtype: e.category.code,
      // A canteen bill or a salary has no vendor worth a ledger, so the party
      // is optional now. The register falls back to the category name, which
      // is the honest answer to "who was this paid to" when nobody was named.
      partyName: e.party?.name ?? e.category.name,
      amount: e.amount,
      href: `/vouchers/expenses/${e.id}`,
    })),
    ...settlements.map((st) => ({
      id: st.id,
      date: st.date,
      createdAt: st.createdAt,
      centreName: st.centre.name,
      kind: st.kind,
      subtype: st.mode,
      partyName: st.party.name,
      amount: st.amount,
      href: `/vouchers/${st.kind === "PAYMENT" ? "payments" : "receipts"}/${st.id}`,
    })),
  ];

  rows.sort((a, b) => {
    const d = a.date.getTime() - b.date.getTime();
    return d !== 0 ? d : a.createdAt.getTime() - b.createdAt.getTime();
  });
  return rows;
}
