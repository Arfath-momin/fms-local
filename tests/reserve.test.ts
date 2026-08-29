import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { reserveBalances, reserveOutstandingFor } from "@/lib/reserve";

/**
 * Reserve is tracked PER MARKET PARTY, never pooled (spec invariant 5).
 *
 * This is the test that guards the bug the rebuild exists to fix. Reserve used
 * to post to one standing account, so three parties holding ₹2,500, ₹2,000 and
 * ₹1,500 read as a single ₹6,000 owed by nobody — a figure that cannot tell
 * you who to ask when it is time to collect.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const D = (n: number) => new Prisma.Decimal(n);
const SUFFIX = `res-${Date.now()}`;
const DAY = new Date("2026-09-05T00:00:00.000Z");

let companyId = "";
let centreId = "";
let scope = { companyId: "", centreId: "" };
const partyIds: Record<string, string> = {};

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
  scope = { companyId, centreId };

  // Three market parties on one day, each withholding a different reserve —
  // and a different cutting, so the two can be told apart.
  for (const [name, total, reserve, cutting] of [
    ["Kondatty", 80_000, 2_500, 800],
    ["City Market", 55_000, 2_000, 550],
    ["Malpe Market", 45_000, 1_500, 450],
  ] as const) {
    const party = await prisma.party.create({
      data: { name: `${name} ${SUFFIX}`, type: "MARKET_BUYER" },
      select: { id: true },
    });
    partyIds[name] = party.id;
    await prisma.sale.create({
      data: {
        ...scope,
        type: "MARKET",
        partyId: party.id,
        billNo: `M-${name}`,
        date: DAY,
        amount: D(total - reserve),
        totalBill: D(total),
        reserve: D(reserve),
        cutting: D(cutting),
      },
    });
  }
});

afterAll(async () => {
  await prisma.reserveCollection.deleteMany({ where: { companyId } });
  await prisma.sale.deleteMany({ where: { companyId } });
  await prisma.centre.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.party.deleteMany({ where: { name: { contains: SUFFIX } } });
  await prisma.$disconnect();
});

describe("reserve balances", () => {
  it("keeps one figure per party, and they sum to the total withheld", async () => {
    const balances = await reserveBalances(scope);
    expect(balances).toHaveLength(3);

    const byName = Object.fromEntries(
      balances.map((b) => [b.partyName.replace(` ${SUFFIX}`, ""), b])
    );
    expect(byName["Kondatty"].outstanding.toNumber()).toBe(2_500);
    expect(byName["City Market"].outstanding.toNumber()).toBe(2_000);
    expect(byName["Malpe Market"].outstanding.toNumber()).toBe(1_500);

    // The total exists, but only as a sum of named parties — never as the
    // stored balance of one pooled account.
    const total = balances.reduce((a, b) => a + b.outstanding.toNumber(), 0);
    expect(total).toBe(6_000);
  });

  it("reduces only the collected party's balance", async () => {
    await prisma.reserveCollection.create({
      data: {
        ...scope,
        partyId: partyIds["City Market"],
        amount: D(1_200),
        date: new Date("2027-03-31T00:00:00.000Z"),
        mode: "CASH",
      },
    });

    const balances = await reserveBalances(scope);
    const byName = Object.fromEntries(
      balances.map((b) => [b.partyName.replace(` ${SUFFIX}`, ""), b])
    );

    expect(byName["City Market"].outstanding.toNumber()).toBe(800);
    // The other two are untouched — which is the whole point of not pooling.
    expect(byName["Kondatty"].outstanding.toNumber()).toBe(2_500);
    expect(byName["Malpe Market"].outstanding.toNumber()).toBe(1_500);
  });

  it("reports what one party still holds, for capping a collection", async () => {
    const held = await reserveOutstandingFor(scope, partyIds["City Market"]);
    expect(held.toNumber()).toBe(800);
  });

  it("counts cutting as its own balance, not as more reserve", async () => {
    // The two are separate figures against the same party. Reading one off the
    // other would let a market's cutting be cleared by collecting its reserve.
    const cut = await reserveBalances(scope, "CUTTING");
    const byName = Object.fromEntries(
      cut.map((b) => [b.partyName.replace(` ${SUFFIX}`, ""), b])
    );
    expect(byName["Kondatty"].outstanding.toNumber()).toBe(800);
    expect(byName["City Market"].outstanding.toNumber()).toBe(550);
    expect(byName["Malpe Market"].outstanding.toNumber()).toBe(450);

    // The 1,200 collected above was RESERVE. Cutting is untouched by it.
    expect(
      (await reserveOutstandingFor(scope, partyIds["City Market"], "CUTTING"))
        .toNumber()
    ).toBe(550);
  });

  it("collecting cutting leaves the reserve balance alone", async () => {
    await prisma.reserveCollection.create({
      data: {
        ...scope,
        kind: "CUTTING",
        partyId: partyIds["Kondatty"],
        amount: D(300),
        date: new Date("2027-03-31T00:00:00.000Z"),
        mode: "CASH",
      },
    });

    expect(
      (await reserveOutstandingFor(scope, partyIds["Kondatty"], "CUTTING"))
        .toNumber()
    ).toBe(500);
    // Untouched, which is the point: one party, two balances, two collections.
    expect(
      (await reserveOutstandingFor(scope, partyIds["Kondatty"])).toNumber()
    ).toBe(2_500);
  });

  it("collecting is recognised on its own date, not the buying day", async () => {
    // The collection above is dated 31 Mar 2027 — a year after the bill it
    // relates to. Reserve is the one thing in the system recognised on the day
    // the money actually arrived.
    const row = await prisma.reserveCollection.findFirstOrThrow({
      where: { companyId, partyId: partyIds["City Market"] },
      select: { date: true },
    });
    expect(row.date.toISOString().slice(0, 10)).toBe("2027-03-31");
  });
});
