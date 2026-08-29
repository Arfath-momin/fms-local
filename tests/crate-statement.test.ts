import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { crateBalances, crateStatement } from "@/lib/crate";

/**
 * The empty-crate account.
 *
 * Crates are BFM's property, on loan to a market until the empties come back.
 * The balance is DERIVED from the rows in order — never stored — so a corrected
 * or deleted row cannot leave a stale total behind it, and every later row's
 * carried-down figure moves with it.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const SUFFIX = `crate-${Date.now()}`;
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

let companyId = "";
let centreId = "";
let scope = { companyId: "", centreId: "" };
let malpe = "";
let kondatty = "";

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

  malpe = (
    await prisma.party.create({
      data: { name: `Malpe ${SUFFIX}`, type: "MARKET_BUYER" },
      select: { id: true },
    })
  ).id;
  kondatty = (
    await prisma.party.create({
      data: { name: `Kondatty ${SUFFIX}`, type: "MARKET_BUYER" },
      select: { id: true },
    })
  ).id;

  // Malpe: already holding 40 when the books opened, then two loads and a
  // partial return. Deliberately out of chronological insertion order for the
  // second and third rows, so the ordering is by DATE and not by arrival.
  await prisma.crateEntry.createMany({
    data: [
      { ...scope, partyId: malpe, date: day("2026-09-01"), boxesOut: 40, boxesReturned: 0 },
      { ...scope, partyId: malpe, date: day("2026-09-10"), boxesOut: 0, boxesReturned: 55 },
      { ...scope, partyId: malpe, date: day("2026-09-05"), boxesOut: 60, boxesReturned: 0 },
      { ...scope, partyId: kondatty, date: day("2026-09-06"), boxesOut: 25, boxesReturned: 10 },
    ],
  });
});

afterAll(async () => {
  await prisma.crateEntry.deleteMany({ where: { companyId } });
  await prisma.expense.deleteMany({ where: { companyId } });
  await prisma.expenseCategory.deleteMany({ where: { companyId } });
  await prisma.deliveryNote.deleteMany({ where: { companyId } });
  await prisma.vehicle.deleteMany({ where: { companyId } });
  await prisma.centre.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.party.deleteMany({ where: { name: { contains: SUFFIX } } });
  await prisma.$disconnect();
});

describe("the trip's own details on a crate row", () => {
  it("names the vehicle and the line man off the trip", async () => {
    // Neither is stored on the crate row. The vehicle belongs to the delivery
    // note and the line man to the voucher that paid him; copying either here
    // would be a second version free to disagree with the first, and the copy
    // is never the one that gets corrected.
    const transporter = await prisma.party.create({
      data: { name: `Ravi ${SUFFIX}`, type: "TRANSPORTER" },
      select: { id: true },
    });
    const vehicle = await prisma.vehicle.create({
      data: { companyId, number: `KA-20-${SUFFIX.slice(-4)}`, transporterId: transporter.id },
      select: { id: true },
    });
    const trip = await prisma.deliveryNote.create({
      data: {
        ...scope,
        billNo: `DN-${SUFFIX}`,
        date: day("2026-09-12"),
        vehicleId: vehicle.id,
      },
      select: { id: true },
    });
    const category = await prisma.expenseCategory.create({
      data: { companyId, code: "LINE_MAN", name: "Line Man", kind: "DIRECT" },
      select: { id: true },
    });
    const suresh = await prisma.party.create({
      data: { name: `Suresh ${SUFFIX}`, type: "LINE_MAN" },
      select: { id: true },
    });
    await prisma.expense.create({
      data: {
        ...scope,
        categoryId: category.id,
        partyId: suresh.id,
        deliveryNoteId: trip.id,
        amount: "500",
        date: day("2026-09-12"),
        spentOn: day("2026-09-12"),
        details: { lineManName: `Suresh ${SUFFIX}` },
      },
    });
    // Its own market, so this test perturbs no other balance. Tests that share
    // a party share a running total, and then the order they run in decides
    // whether they pass.
    const udupi = await prisma.party.create({
      data: { name: `Udupi ${SUFFIX}`, type: "MARKET_BUYER" },
      select: { id: true },
    });
    await prisma.crateEntry.createMany({
      data: [
        { ...scope, partyId: udupi.id, date: day("2026-09-02"), boxesOut: 15 },
        {
          ...scope,
          partyId: udupi.id,
          date: day("2026-09-12"),
          deliveryNoteId: trip.id,
          place: "Malpe",
          boxesOut: 30,
        },
      ],
    });

    const row = (await crateStatement(scope, udupi.id)).at(-1)!;
    expect(row.vehicleNumber).toBe(`KA-20-${SUFFIX.slice(-4)}`);
    expect(row.lineManName).toBe(`Suresh ${SUFFIX}`);
    expect(row.tripBillNo).toBe(`DN-${SUFFIX}`);
    expect(row.place).toBe("Malpe");
    // And it still carries the balance down: 15 held, 30 more out.
    expect(row.openingBalance).toBe(15);
    expect(row.balance).toBe(45);
  });

  it("leaves an opening row with no trip, and no vehicle to invent", async () => {
    // A market already holding crates when the books open gets one row with no
    // trip. That needs no special mechanism — an opening balance is just the
    // first row — and it is why these two fields are read through the trip
    // rather than stored, where an opening row would have to make them up.
    const opening = (await crateStatement(scope, malpe))[0];
    expect(opening.tripId).toBeNull();
    expect(opening.vehicleNumber).toBeNull();
    expect(opening.lineManName).toBeNull();
    expect(opening.openingBalance).toBe(0);
  });
});

describe("a market's crate statement", () => {
  it("carries the balance down, oldest first", async () => {
    const rows = await crateStatement(scope, malpe);
    expect(rows.map((r) => r.balance)).toEqual([40, 100, 45]);
    // Each row's opening is the previous row's close — which is what makes the
    // statement readable rather than a column of unrelated figures.
    expect(rows.map((r) => r.openingBalance)).toEqual([0, 40, 100]);
  });

  it("orders by the date, not by when the row was typed", async () => {
    // The 10th was entered before the 5th. A statement that followed insertion
    // order would show a return of 55 against a balance of 40 and then go
    // negative — a discrepancy invented purely by the order of typing.
    const rows = await crateStatement(scope, malpe);
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-09-05",
      "2026-09-10",
    ]);
    expect(rows.every((r) => r.balance >= 0)).toBe(true);
  });

  it("nets out to what the market still holds", async () => {
    const rows = await crateStatement(scope, malpe);
    expect(rows.at(-1)!.balance).toBe(45);
    const balances = await crateBalances(scope);
    expect(balances.find((b) => b.partyId === malpe)!.holding).toBe(45);
  });

  it("keeps one balance per market, never pooled", async () => {
    const balances = await crateBalances(scope);
    expect(balances.find((b) => b.partyId === malpe)!.holding).toBe(45);
    expect(balances.find((b) => b.partyId === kondatty)!.holding).toBe(15);
    // The total exists, but only ever as the sum of named markets — the same
    // rule reserve follows. A pooled figure cannot tell you whose crates to
    // chase, so it is asserted as the sum of the parts rather than as a
    // constant, which is the property that actually matters.
    expect(balances.reduce((a, b) => a + b.holding, 0)).toBe(
      balances.reduce((a, b) => a + (b.out - b.returned), 0)
    );
    expect(balances.every((b) => b.partyName !== "")).toBe(true);
  });

  it("re-derives the whole account when a row is removed", async () => {
    const rows = await crateStatement(scope, malpe);
    const middle = rows[1];
    await prisma.crateEntry.delete({ where: { id: middle.id } });

    const after = await crateStatement(scope, malpe);
    // The 60 that went out on the 5th is gone, so the return on the 10th now
    // takes the account negative — which is the truth once that load is not
    // there, and exactly why the balance is not a stored column.
    expect(after.map((r) => r.balance)).toEqual([40, -15]);

    await prisma.crateEntry.create({
      data: {
        ...scope,
        partyId: malpe,
        date: middle.date,
        boxesOut: middle.boxesOut,
        boxesReturned: middle.boxesReturned,
      },
    });
    expect((await crateStatement(scope, malpe)).at(-1)!.balance).toBe(45);
  });
});
