import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { postLedgerEntries } from "@/lib/ledger";

/**
 * The rent a market paid the driver, posted against a real database.
 *
 * The arithmetic is covered elsewhere; what this checks is that the three
 * parties actually END somewhere correct once the entries hit the ledger and
 * the running balances are recomputed. That is the part that has been wrong
 * twice — once by crediting the market against a net already reduced by the
 * rent, and once by removing the transporter's debit along with that bad
 * credit — and both times the arithmetic in isolation looked fine.
 *
 * Sign convention: a positive running balance means the party owes BFM.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const D = (n: number) => new Prisma.Decimal(n);
const SUFFIX = `rr-${Date.now()}`;
const DAY = new Date("2026-09-10T00:00:00.000Z");

// The bill: total 45,000 less commission 900, reserve 1,500 and labour 500.
const NET = 42_100;
const PAID_BY_MARKET = 15_000;
const RENT = 20_000;
const ADVANCE = 5_000;

let companyId = "";
let centreId = "";
let marketId = "";
let transporterId = "";
const saleId = "11111111-1111-4111-8111-111111111111";
const tripId = "22222222-2222-4222-8222-222222222222";

const closing = async (partyId: string) =>
  (
    await prisma.ledgerEntry.findFirstOrThrow({
      where: { partyId },
      orderBy: [{ date: "desc" }, { seq: "desc" }],
      select: { runningBalance: true },
    })
  ).runningBalance.toNumber();

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

  const market = await prisma.party.create({
    data: { name: `Malpe ${SUFFIX}`, type: "MARKET_BUYER" },
    select: { id: true },
  });
  marketId = market.id;
  const transporter = await prisma.party.create({
    data: { name: `Ravi ${SUFFIX}`, type: "TRANSPORTER" },
    select: { id: true },
  });
  transporterId = transporter.id;

  const scope = { companyId, centreId };

  // The trip: an advance handed to the driver at loading.
  await postLedgerEntries(prisma, [
    {
      ...scope,
      partyId: transporterId,
      type: "DEBIT",
      sourceType: "PAYMENT",
      sourceId: tripId,
      amount: D(ADVANCE),
      date: DAY,
    },
  ]);

  // The rent expense: the whole rent credited to the transporter.
  await postLedgerEntries(prisma, [
    {
      ...scope,
      partyId: transporterId,
      type: "CREDIT",
      sourceType: "RENT",
      sourceId: `${tripId}-rent`,
      amount: D(RENT),
      date: DAY,
    },
  ]);

  // The bill, exactly as postSaleLedger now writes it: the market is debited
  // the WHOLE net, credited back what it handed the driver, and the transporter
  // is debited the same.
  await postLedgerEntries(prisma, [
    {
      ...scope,
      partyId: marketId,
      type: "DEBIT",
      sourceType: "SALE",
      sourceId: saleId,
      amount: D(NET),
      date: DAY,
    },
    {
      ...scope,
      partyId: marketId,
      type: "CREDIT",
      sourceType: "RECEIPT",
      sourceId: saleId,
      amount: D(PAID_BY_MARKET),
      date: DAY,
    },
    {
      ...scope,
      partyId: transporterId,
      type: "DEBIT",
      sourceType: "RENT_BY_PARTY",
      sourceId: saleId,
      amount: D(PAID_BY_MARKET),
      date: DAY,
    },
  ]);
});

afterAll(async () => {
  await prisma.ledgerEntry.deleteMany({ where: { companyId } });
  await prisma.centre.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.party.deleteMany({ where: { name: { contains: SUFFIX } } });
  await prisma.$disconnect();
});

describe("a market that paid the driver", () => {
  it("is billed the whole net, not the net less the rent", async () => {
    const debit = await prisma.ledgerEntry.findFirstOrThrow({
      where: { partyId: marketId, sourceType: "SALE" },
      select: { amount: true },
    });
    expect(debit.amount.toNumber()).toBe(42_100);
  });

  it("shows the rent as a receipt against that bill", async () => {
    const receipt = await prisma.ledgerEntry.findFirstOrThrow({
      where: { partyId: marketId, sourceType: "RECEIPT" },
      select: { amount: true, sourceId: true },
    });
    expect(receipt.amount.toNumber()).toBe(15_000);
    // Sourced from the SALE, so it drills through to the bill on the statement
    // and disappears with it if the bill is ever deleted.
    expect(receipt.sourceId).toBe(saleId);
  });

  it("leaves the market owing what its own paper says", async () => {
    expect(await closing(marketId)).toBe(27_100);
  });

  it("closes the transporter at zero", async () => {
    // Advance 5,000 debited, rent 20,000 credited, 15,000 debited for what the
    // market handed him. He has been paid in full, by two different hands.
    expect(await closing(transporterId)).toBe(0);
  });

  it("does not leave the market a creditor after it settles", async () => {
    // The old double-count showed up exactly here: the market pays the 27,100
    // printed on its bill and should close at zero, not at −15,000.
    await postLedgerEntries(prisma, [
      {
        companyId,
        centreId,
        partyId: marketId,
        type: "CREDIT",
        sourceType: "RECEIPT",
        sourceId: "33333333-3333-4333-8333-333333333333",
        amount: D(27_100),
        date: DAY,
      },
    ]);
    expect(await closing(marketId)).toBe(0);
  });
});
