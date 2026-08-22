import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeProfit } from "@/lib/report";

/**
 * Phase 4's gate:
 *
 *   "a month-end salary voucher does not move any buying day's gross profit,
 *    and appears in the month's net profit"
 *
 * This is the reason expense categories became data. As an enum there was
 * nowhere to record whether a cost belongs to a catch or to the month, so every
 * expense was charged to the day it was dated — which made a salary look like a
 * cost of whichever day's fish happened to be bought that morning.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const D = (n: number) => new Prisma.Decimal(n);
const SUFFIX = `tier-${Date.now()}`;
const BUYING_DAY = new Date("2026-10-05T00:00:00.000Z");
const MONTH_START = new Date("2026-10-01T00:00:00.000Z");
const MONTH_END = new Date("2026-10-31T00:00:00.000Z");

let companyId = "";
let centreId = "";

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: `ZZ-${SUFFIX}` },
    select: { id: true },
  });
  companyId = company.id;
  const centre = await prisma.centre.create({
    data: { companyId, name: "Test Centre" },
    select: { id: true },
  });
  centreId = centre.id;

  const [ice, salary] = await Promise.all([
    prisma.expenseCategory.create({
      data: { companyId, code: "ICE", name: "Ice", kind: "DIRECT" },
      select: { id: true },
    }),
    prisma.expenseCategory.create({
      data: { companyId, code: "SALARY", name: "Salaries", kind: "OVERHEAD" },
      select: { id: true },
    }),
  ]);

  const seller = await prisma.party.create({
    data: { name: `Seller ${SUFFIX}`, type: "PURCHASE_GROUP" },
    select: { id: true },
  });
  const buyer = await prisma.party.create({
    data: { name: `Buyer ${SUFFIX}`, type: "LOCAL_BUYER" },
    select: { id: true },
  });

  const scope = { companyId, centreId };
  await prisma.purchase.create({
    data: { ...scope, partyId: seller.id, type: "SOCIETY", amount: D(60_000), date: BUYING_DAY },
  });
  await prisma.sale.create({
    data: { ...scope, type: "LOCAL", partyId: buyer.id, billNo: "L-1", date: BUYING_DAY, amount: D(100_000) },
  });
  // A direct cost of that catch...
  await prisma.expense.create({
    data: { ...scope, categoryId: ice.id, amount: D(10_000), date: BUYING_DAY },
  });
  // ...and the month's salaries, dated to the SAME day, which is the trap.
  await prisma.expense.create({
    data: { ...scope, categoryId: salary.id, amount: D(25_000), date: BUYING_DAY },
  });
});

afterAll(async () => {
  await prisma.expense.deleteMany({ where: { companyId } });
  await prisma.sale.deleteMany({ where: { companyId } });
  await prisma.purchase.deleteMany({ where: { companyId } });
  await prisma.expenseCategory.deleteMany({ where: { companyId } });
  await prisma.centre.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.party.deleteMany({ where: { name: { contains: SUFFIX } } });
  await prisma.$disconnect();
});

describe("Phase 4 gate: overheads stay out of the buying day", () => {
  it("charges gross only the DIRECT cost, even when both are dated the same day", async () => {
    const r = await computeProfit(companyId, centreId, BUYING_DAY, BUYING_DAY);

    expect(r.sale.toNumber()).toBe(100_000);
    expect(r.purchase.toNumber()).toBe(60_000);
    expect(r.directExpense.toNumber()).toBe(10_000);
    expect(r.overheadExpense.toNumber()).toBe(25_000);

    // 100,000 − 60,000 − 10,000. The salary is dated to this day and STILL
    // does not touch it, which is the whole point of the tier.
    expect(r.grossProfit.toNumber()).toBe(30_000);
  });

  it("takes the salary off net profit for the month", async () => {
    const r = await computeProfit(companyId, centreId, MONTH_START, MONTH_END);
    expect(r.grossProfit.toNumber()).toBe(30_000);
    // 30,000 gross − 25,000 overheads, no reserve collected.
    expect(r.netProfit.toNumber()).toBe(5_000);
  });

  it("still reports the full expense figure for list screens", async () => {
    const r = await computeProfit(companyId, centreId, BUYING_DAY, BUYING_DAY);
    // Both tiers together — what was actually spent, which a Day Book still
    // wants even though profit splits it.
    expect(r.expense.toNumber()).toBe(35_000);
  });
});
