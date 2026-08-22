import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { postLedgerEntries } from "@/lib/ledger";

/**
 * Back-dated ledger inserts.
 *
 * This is an integration test on purpose: recomputeRunningBalance() is one raw
 * SQL window function, so testing it in isolation would only test a mock of the
 * thing that can actually be wrong.
 *
 * It matters more here than in most ledgers. Bills come back two or three days
 * after the fish moved and are accounted to the BUYING day, so an entry landing
 * before existing ones is the normal case, not an edge case. The old code read
 * the previous balance and added a delta, which silently corrupted every later
 * row the moment that happened.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const D = (n: number) => new Prisma.Decimal(n);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const SUFFIX = `test-${Date.now()}`;

afterAll(async () => {
  // Scoped teardown: only what this file made, so a failure never takes real
  // seed data with it.
  const company = await prisma.company.findUnique({
    where: { name: `ZZ-${SUFFIX}` },
    select: { id: true },
  });
  if (company) {
    await prisma.ledgerEntry.deleteMany({ where: { companyId: company.id } });
    await prisma.centre.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
  await prisma.party.deleteMany({ where: { name: `Boat ${SUFFIX}` } });
  await prisma.$disconnect();
});

describe("running balance after a back-dated insert", () => {
  it("matches a full recompute of the chain", async () => {
    const company = await prisma.company.create({
      data: { name: `ZZ-${SUFFIX}` },
      select: { id: true },
    });
    const centre = await prisma.centre.create({
      data: { companyId: company.id, name: "Test Centre" },
      select: { id: true },
    });
    const party = await prisma.party.create({
      data: { name: `Boat ${SUFFIX}`, type: "PURCHASE_GROUP" },
      select: { id: true },
    });

    const scope = {
      companyId: company.id,
      centreId: centre.id,
      partyId: party.id,
    };
    const base = { ...scope, sourceType: "PURCHASE" as const };

    // Two bills for the 17th and the 19th, entered in order.
    await postLedgerEntries(prisma, [
      { ...base, type: "CREDIT", sourceId: "s1", amount: D(10_000), date: day("2026-08-17") },
      { ...base, type: "CREDIT", sourceId: "s2", amount: D(5_000), date: day("2026-08-19") },
    ]);

    // Now the 18th's bill turns up late — BETWEEN the two already posted.
    await postLedgerEntries(prisma, [
      { ...base, type: "CREDIT", sourceId: "s3", amount: D(2_000), date: day("2026-08-18") },
    ]);

    const rows = await prisma.ledgerEntry.findMany({
      where: scope,
      orderBy: [{ date: "asc" }, { seq: "asc" }],
      select: { date: true, type: true, amount: true, runningBalance: true },
    });

    expect(rows).toHaveLength(3);

    // Recompute independently, exactly as scripts/verify-ledger.ts does.
    let expected = new Prisma.Decimal(0);
    for (const r of rows) {
      expected =
        r.type === "DEBIT" ? expected.add(r.amount) : expected.sub(r.amount);
      expect(r.runningBalance.toString()).toBe(expected.toString());
    }

    // And the chain reads in date order with the late bill in its right place:
    // −10,000 → −12,000 → −17,000. A delta-based implementation would have
    // left the 19th at −15,000, understating what is owed by the late bill.
    expect(rows.map((r) => r.runningBalance.toString())).toEqual([
      "-10000",
      "-12000",
      "-17000",
    ]);
  });
});
