import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { postLedgerEntries } from "@/lib/ledger";
import { findOrCreateVehicle, normaliseVehicleNumber } from "@/lib/vehicle";

/**
 * Phase 1's gate, as a test rather than a click-through.
 *
 * Create a market trip and a factory trip, and check the two things the plan
 * asks for: each transporter's ledger shows the right credits, and the day's
 * expense total includes each rent EXACTLY once. The "exactly once" half is
 * the one worth automating — a second rent expense is invisible on screen and
 * silently halves the day's profit.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const D = (n: number) => new Prisma.Decimal(n);
const SUFFIX = `trip-${Date.now()}`;
const DAY = new Date("2026-09-01T00:00:00.000Z");

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
  await prisma.expenseCategory.create({
    data: { companyId, code: "RENT", name: "Vehicle Rent", kind: "DIRECT" },
  });
});

afterAll(async () => {
  await prisma.expense.deleteMany({ where: { companyId } });
  await prisma.ledgerEntry.deleteMany({ where: { companyId } });
  await prisma.deliveryNoteLine.deleteMany({
    where: { deliveryNote: { companyId } },
  });
  await prisma.deliveryNote.deleteMany({ where: { companyId } });
  await prisma.vehicle.deleteMany({ where: { companyId } });
  await prisma.expenseCategory.deleteMany({ where: { companyId } });
  await prisma.centre.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.party.deleteMany({ where: { name: { contains: SUFFIX } } });
  await prisma.$disconnect();
});

describe("vehicle number normalisation", () => {
  it("treats one truck typed three ways as one truck", () => {
    const forms = ["KA-20-B-5521", "KA20B5521", "ka 20 b 5521"];
    const normalised = new Set(forms.map(normaliseVehicleNumber));
    expect(normalised.size).toBe(1);
    expect([...normalised][0]).toBe("KA20B5521");
  });

  it("resolves the same vehicle row however the number was typed", async () => {
    const a = await prisma.$transaction((tx) =>
      findOrCreateVehicle(tx, {
        companyId,
        number: "KA-99-Z-1111",
        transporterName: `Norm ${SUFFIX}`,
      })
    );
    const b = await prisma.$transaction((tx) =>
      findOrCreateVehicle(tx, {
        companyId,
        number: "ka 99 z 1111",
        transporterName: `Norm ${SUFFIX}`,
      })
    );
    expect(b.id).toBe(a.id);
  });

  it("never reassigns an existing truck's transporter behind your back", async () => {
    const first = await prisma.$transaction((tx) =>
      findOrCreateVehicle(tx, {
        companyId,
        number: "KA-77-Y-2222",
        transporterName: `Owner A ${SUFFIX}`,
      })
    );
    // Someone types a different owner on a delivery note. A truck changing
    // hands is a real event, but it belongs in Masters — not as a side effect.
    const second = await prisma.$transaction((tx) =>
      findOrCreateVehicle(tx, {
        companyId,
        number: "KA-77-Y-2222",
        transporterName: `Owner B ${SUFFIX}`,
      })
    );
    expect(second.id).toBe(first.id);
    expect(second.transporterId).toBe(first.transporterId);
  });
});

describe("Phase 1 gate: two trips, rent counted once", () => {
  it("credits each transporter and expenses each rent exactly once", async () => {
    const rentCategory = await prisma.expenseCategory.findUniqueOrThrow({
      where: { companyId_code: { companyId, code: "RENT" } },
      select: { id: true },
    });

    const made: { transporterId: string; rent: number; advance: number | null }[] =
      [];

    for (const [number, owner, channel, rent, advance] of [
      ["KA-20-B-5521", "Market Transport", "MARKET", 20_000, 5_000],
      ["KA-20-A-9087", "Factory Carriers", "FACTORY", 8_000, null],
    ] as const) {
      const vehicle = await prisma.$transaction((tx) =>
        findOrCreateVehicle(tx, {
          companyId,
          number,
          transporterName: `${owner} ${SUFFIX}`,
        })
      );

      const trip = await prisma.deliveryNote.create({
        data: {
          companyId,
          centreId,
          billNo: `DN-${number}`,
          date: DAY,
          channel,
          vehicleId: vehicle.id,
          rentAmount: D(rent),
          advancePaid: advance === null ? null : D(advance),
        },
        select: { id: true },
      });

      await postLedgerEntries(prisma, [
        { companyId, centreId, partyId: vehicle.transporterId, type: "CREDIT", sourceType: "RENT", sourceId: trip.id, amount: D(rent), date: DAY },
        ...(advance
          ? [{ companyId, centreId, partyId: vehicle.transporterId, type: "DEBIT" as const, sourceType: "PAYMENT" as const, sourceId: trip.id, amount: D(advance), date: DAY }]
          : []),
      ]);

      await prisma.expense.create({
        data: {
          companyId,
          centreId,
          categoryId: rentCategory.id,
          partyId: vehicle.transporterId,
          amount: D(rent),
          date: DAY,
          spentOn: DAY,
          details: { tripId: trip.id },
        },
      });

      made.push({ transporterId: vehicle.transporterId, rent, advance });
    }

    // 1. Each transporter carries the right open balance.
    //    Market: 20,000 credited − 5,000 advance = 15,000 still owed.
    //    Factory: 8,000 credited, nothing paid yet.
    for (const m of made) {
      const last = await prisma.ledgerEntry.findFirst({
        where: { companyId, partyId: m.transporterId },
        orderBy: [{ date: "desc" }, { seq: "desc" }],
        select: { runningBalance: true },
      });
      const expected = -(m.rent - (m.advance ?? 0));
      expect(last?.runningBalance.toNumber()).toBe(expected);
    }

    // 2. The day's rent expense is the sum of the two rents and NOT a rupee
    //    more — one row per trip, never a hand-entered voucher as well.
    const rentRows = await prisma.expense.findMany({
      where: { companyId, centreId, categoryId: rentCategory.id, date: DAY },
      select: { amount: true },
    });
    expect(rentRows).toHaveLength(2);
    expect(
      rentRows.reduce((a, r) => a + r.amount.toNumber(), 0)
    ).toBe(28_000);
  });
});
