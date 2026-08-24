import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { recomputeRunningBalance } from "@/lib/ledger";

/**
 * Two clerks posting to ONE party ledger at the same moment.
 *
 * A regression test for a confirmed corruption, not a hypothetical. The
 * recompute is a window function over the party's whole chain, and under READ
 * COMMITTED each statement takes its own snapshot:
 *
 *   T1 inserts A (10,000). T2 inserts B (5,000). Neither has committed.
 *   T1 recomputes and sees only A. T2 recomputes and sees only B.
 *   They write DIFFERENT rows, so no row lock ever collides, and both commit.
 *
 * The chain was then left reading 10,000 / 5,000 instead of 10,000 / 15,000 —
 * and the last figure in the chain is what getPartyBalance() returns as "what
 * this party owes", printed on statements and shown on every payment form.
 * Nothing errored, and nobody would have known until a party disputed a bill.
 *
 * The fix is a transaction-scoped advisory lock on the chain, taken inside
 * recomputeRunningBalance(). This test fails without it.
 *
 * Integration, necessarily: the bug lives in Postgres' concurrency semantics,
 * so a mock would prove nothing about the thing that was actually wrong. It
 * needs TWO clients — one pool connection cannot interleave two transactions.
 */
const url = process.env.DATABASE_URL!;
const mk = () =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const prisma = mk();
const clientA = mk();
const clientB = mk();

const D = (n: number) => new Prisma.Decimal(n);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const SUFFIX = `conc-${Date.now()}`;

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
  await Promise.all([
    prisma.$disconnect(),
    clientA.$disconnect(),
    clientB.$disconnect(),
  ]);
});

describe("two vouchers posted to one party ledger at the same moment", () => {
  it("leaves the running balance chain intact", async () => {
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

    // The pause is the point: it holds each transaction open across the other's
    // insert, so both recomputes run against a chain the other has already
    // added to but not committed. Without it the two serialise by luck and the
    // bug hides.
    const overlap = () => new Promise((r) => setTimeout(r, 400));

    // Exactly the call every voucher action makes — insert, then recompute,
    // inside one transaction. Nothing about this test is a special path.
    const post = (client: PrismaClient, sourceId: string, amount: number) =>
      client.$transaction(
        async (tx) => {
          // The insert first, on its own, so the row is visible to this
          // transaction but not yet committed...
          await tx.ledgerEntry.create({
            data: {
              ...scope,
              type: "CREDIT",
              sourceType: "PURCHASE",
              sourceId,
              amount: D(amount),
              date: day("2026-08-17"),
              runningBalance: D(0),
            },
          });
          // ...then the wait, so the other transaction gets its insert in...
          await overlap();
          // ...and only then the recompute, which is where the two collide.
          await recomputeRunningBalance(tx, scope);
        },
        { timeout: 20_000 }
      );

    await Promise.all([
      post(clientA, `${SUFFIX}-a`, 10_000),
      post(clientB, `${SUFFIX}-b`, 5_000),
    ]);

    const rows = await prisma.ledgerEntry.findMany({
      where: scope,
      orderBy: [{ date: "asc" }, { seq: "asc" }],
      select: { type: true, amount: true, runningBalance: true },
    });

    expect(rows).toHaveLength(2);

    // Recompute independently, exactly as scripts/verify-ledger.ts does. Both
    // entries are credits, so the chain must close at -15,000 — we owe the boat
    // 15,000.
    let expected = new Prisma.Decimal(0);
    for (const r of rows) {
      expected =
        r.type === "DEBIT" ? expected.add(r.amount) : expected.sub(r.amount);
      expect(r.runningBalance.toString()).toBe(expected.toString());
    }
    expect(expected.toString()).toBe("-15000");
  }, 30_000);
});
