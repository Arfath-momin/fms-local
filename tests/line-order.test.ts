import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * A voucher's rows come back in the order they were typed.
 *
 * They were read `orderBy: id`, and the id is a random UUID — so the order was
 * arbitrary, and an EDIT made it arbitrary AGAIN, because saving deletes every
 * line and recreates it with a fresh uuid. A merchant who corrected the third
 * row of a delivery note and found the whole table rearranged had no way to
 * tell whether the correction had taken.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const D = (n: number) => new Prisma.Decimal(n);
const SUFFIX = `ord-${Date.now()}`;
const TYPED = ["Prawns", "Mackerel", "Sardine", "Pomfret", "Seer"];

let companyId = "";
let centreId = "";
let noteId = "";

const write = (boxes: number[]) =>
  prisma.deliveryNoteLine.createMany({
    data: TYPED.map((particulars, i) => ({
      deliveryNoteId: noteId,
      sortOrder: i,
      pack: "BOX" as const,
      particulars,
      kg: D(boxes[i] * 20),
      box: boxes[i],
      pcs: 0,
    })),
  });

const read = () =>
  prisma.deliveryNoteLine.findMany({
    where: { deliveryNoteId: noteId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { particulars: true, box: true },
  });

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
  const transporter = await prisma.party.create({
    data: { name: `T ${SUFFIX}`, type: "TRANSPORTER" },
    select: { id: true },
  });
  const vehicle = await prisma.vehicle.create({
    data: { companyId, number: `KA-${SUFFIX.slice(-5)}`, transporterId: transporter.id },
    select: { id: true },
  });
  const note = await prisma.deliveryNote.create({
    data: {
      companyId, centreId, vehicleId: vehicle.id,
      billNo: `DN-${SUFFIX}`, date: new Date("2026-08-30T00:00:00.000Z"),
    },
    select: { id: true },
  });
  noteId = note.id;
  await write([10, 20, 5, 2, 1]);
});

afterAll(async () => {
  await prisma.deliveryNoteLine.deleteMany({ where: { deliveryNoteId: noteId } });
  await prisma.deliveryNote.deleteMany({ where: { companyId } });
  await prisma.vehicle.deleteMany({ where: { companyId } });
  await prisma.centre.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.party.deleteMany({ where: { name: { contains: SUFFIX } } });
  await prisma.$disconnect();
});

describe("a voucher's rows", () => {
  it("come back in the order they were typed", async () => {
    expect((await read()).map((l) => l.particulars)).toEqual(TYPED);
  });

  it("keep that order after an edit rewrites every row", async () => {
    // Exactly what saving does: delete them all, create them again. Every row
    // gets a NEW uuid here, which is what used to reshuffle the table.
    await prisma.deliveryNoteLine.deleteMany({ where: { deliveryNoteId: noteId } });
    await write([10, 20, 7, 3, 1]);

    const rows = await read();
    expect(rows.map((l) => l.particulars)).toEqual(TYPED);
    // And the correction is on the row it was typed against, not another.
    expect(rows.map((l) => l.box)).toEqual([10, 20, 7, 3, 1]);
  });

  it("adds up to what was entered", async () => {
    // The merchant's own arithmetic: 10 + 20 + 7 + 3 + 1.
    const rows = await read();
    expect(rows.reduce((a, l) => a + l.box, 0)).toBe(41);
  });

  it("survives a row being removed in the middle", async () => {
    // Four rows where there were five, renumbered from zero — the gap must not
    // leave the survivors out of order.
    await prisma.deliveryNoteLine.deleteMany({ where: { deliveryNoteId: noteId } });
    await prisma.deliveryNoteLine.createMany({
      data: [TYPED[0], TYPED[1], TYPED[3], TYPED[4]].map((particulars, i) => ({
        deliveryNoteId: noteId,
        sortOrder: i,
        pack: "BOX" as const,
        particulars,
        kg: D(20),
        box: 1,
        pcs: 0,
      })),
    });
    expect((await read()).map((l) => l.particulars)).toEqual([
      "Prawns",
      "Mackerel",
      "Pomfret",
      "Seer",
    ]);
  });
});
