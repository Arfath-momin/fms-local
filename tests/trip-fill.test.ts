import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { openTrips } from "@/lib/trip";

/**
 * Naming a trip lays out what the truck still has.
 *
 * The merchant's own worked example, as a test. One journey, two stops, and the
 * boxes have to come back to what was rejected:
 *
 *   DN      50 box prawns 750 kg · 60 box mackerel 900 kg
 *   stop 1  factory takes 45 / 675 and 50 / 750
 *   stop 2  the same trip now offers 5 / 75 and 10 / 150
 *           sold locally: 5 / 75 and 8 / 120
 *   left    2 box mackerel — the rejected returns, and the box statement says so
 *
 * Integration because it is the SQL that has to be right: the remaining figures
 * are dispatched less every other bill on the trip, and the bill being edited
 * has to get its own boxes back or no bill could ever be corrected.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const D = (n: number) => new Prisma.Decimal(n);
const SUFFIX = `fill-${Date.now()}`;
const ids: { dn?: string; sales: string[]; vehicle?: string; parties: string[] } = {
  sales: [],
  parties: [],
};

afterAll(async () => {
  // Scoped teardown: only what this file made.
  await prisma.saleLine.deleteMany({ where: { saleId: { in: ids.sales } } });
  await prisma.sale.deleteMany({ where: { id: { in: ids.sales } } });
  if (ids.dn) {
    await prisma.deliveryNoteLine.deleteMany({ where: { deliveryNoteId: ids.dn } });
    await prisma.deliveryNote.delete({ where: { id: ids.dn } });
  }
  if (ids.vehicle) await prisma.vehicle.delete({ where: { id: ids.vehicle } });
  await prisma.party.deleteMany({ where: { id: { in: ids.parties } } });
  await prisma.$disconnect();
});

describe("one journey, two stops", () => {
  it("offers the load, then what is left of it, then the rejects", async () => {
    const company = await prisma.company.findFirstOrThrow({
      where: { name: "BFM" },
      select: { id: true },
    });
    const centre = await prisma.centre.findFirstOrThrow({
      where: { companyId: company.id },
      select: { id: true },
    });
    const scope = { companyId: company.id, centreId: centre.id };
    const date = new Date("2026-08-28T00:00:00.000Z");

    const transporter = await prisma.party.create({
      data: { name: `T ${SUFFIX}`, type: "TRANSPORTER" },
      select: { id: true },
    });
    const buyer = await prisma.party.create({
      data: { name: `B ${SUFFIX}`, type: "FACTORY" },
      select: { id: true },
    });
    ids.parties.push(transporter.id, buyer.id);

    const vehicle = await prisma.vehicle.create({
      data: {
        companyId: company.id,
        number: `KA-${SUFFIX}`.slice(0, 20),
        transporterId: transporter.id,
      },
      select: { id: true },
    });
    ids.vehicle = vehicle.id;

    const dn = await prisma.deliveryNote.create({
      data: {
        ...scope,
        billNo: `DN-${SUFFIX}`.slice(0, 20),
        date,
        vehicleId: vehicle.id,
        status: "DISPATCHED",
        lines: {
          create: [
            { particulars: "Prawns", box: 50, kg: D(750) },
            { particulars: "Mackerel", box: 60, kg: D(900) },
          ],
        },
      },
      select: { id: true },
    });
    ids.dn = dn.id;

    const offered = async (excludeSaleId?: string) => {
      const all = await openTrips(scope, dn.id, excludeSaleId ?? null);
      const t = all.find((x) => x.id === dn.id);
      return (t?.remaining ?? [])
        .map((r) => `${r.box} ${r.particular} ${r.kg}`)
        .sort();
    };

    // Stop 1 — the whole load, as dispatched.
    expect(await offered()).toEqual(["50 Prawns 750", "60 Mackerel 900"].sort());

    const stop1 = await prisma.sale.create({
      data: {
        ...scope,
        type: "FACTORY",
        billNo: `F-${SUFFIX}`.slice(0, 20),
        date,
        partyId: buyer.id,
        deliveryNoteId: dn.id,
        amount: D(176_250),
        lines: {
          create: [
            { particular: "Prawns", box: 45, qtyKg: D(675), ratePerKg: D(150), total: D(101_250) },
            { particular: "Mackerel", box: 50, qtyKg: D(750), ratePerKg: D(100), total: D(75_000) },
          ],
        },
      },
      select: { id: true },
    });
    ids.sales.push(stop1.id);

    // Stop 2 — the same trip, now offering only what came back.
    expect(await offered()).toEqual(["5 Prawns 75", "10 Mackerel 150"].sort());

    const stop2 = await prisma.sale.create({
      data: {
        ...scope,
        type: "LOCAL",
        billNo: `L-${SUFFIX}`.slice(0, 20),
        date,
        partyId: buyer.id,
        deliveryNoteId: dn.id,
        amount: D(23_250),
        lines: {
          create: [
            { particular: "Prawns", box: 5, qtyKg: D(75), ratePerKg: D(150), total: D(11_250) },
            { particular: "Mackerel", box: 8, qtyKg: D(120), ratePerKg: D(100), total: D(12_000) },
          ],
        },
      },
      select: { id: true },
    });
    ids.sales.push(stop2.id);

    // What is left is the rejection, and nothing else.
    expect(await offered()).toEqual(["2 Mackerel 30"]);

    // Re-opening stop 1 must offer ITS OWN boxes back, or no bill on a trip
    // could ever be corrected — every edit would collide with itself.
    expect(await offered(stop1.id)).toEqual(
      ["45 Prawns 675", "52 Mackerel 780"].sort()
    );
  }, 30_000);
});
