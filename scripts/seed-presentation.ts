// Presentation seed (simplified Purchase / Expense / Sale model).
// Wipes ALL transactional data and rebuilds three genuine trading days
// (17–19 Jul 2026) for both companies (BFM, B2B).
//
// It replays the exact ledger effects the app's server actions post — purchase
// CREDIT (+ PAYMENT when paid), expense CREDIT (+ PAYMENT when paid), settlement
// DEBIT SALE + CREDIT PAYMENT — and resolves every boat / seller / buyer / vendor
// to a Party via the same find-or-create by (name, type). Days 17 & 18 are
// closed; day 19 (today) is left open for a live demo.
//
// Run:  npx tsx scripts/seed-presentation.ts
import "dotenv/config";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import type {
  DeliveryChannel,
  ExpenseCategory,
  PartyType,
  PurchaseType,
} from "../src/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const dec = (n: number | string) => new Prisma.Decimal(n);
const date = (d: string) => new Date(`${d}T00:00:00.000Z`);
const d17 = date("2026-07-17");
const d18 = date("2026-07-18");
const d19 = date("2026-07-19");

type Tx = Prisma.TransactionClient;

const PURCHASE_SELLER_TYPE: Record<PurchaseType, PartyType> = {
  SOCIETY: "BOAT",
  KFDC: "BOAT",
  PRIVATE: "BOAT",
  LOCAL: "LOCAL_SELLER",
};
const CHANNEL_BUYER_TYPE: Record<DeliveryChannel, PartyType> = {
  MARKET: "MARKET_BUYER",
  FACTORY: "FACTORY",
  FISH_MILL: "FISH_MILL",
  LOCAL: "LOCAL_BUYER",
};

// ---------- effect helpers (mirror src/lib + server actions exactly) ----------

async function findOrCreateParty(tx: Tx, name: string, type: PartyType): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  const existing = await tx.party.findUnique({
    where: { name_type: { name: clean, type } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.party.create({ data: { name: clean, type }, select: { id: true } });
  return created.id;
}

async function postLedger(
  tx: Tx,
  companyId: string,
  partyId: string,
  type: "DEBIT" | "CREDIT",
  sourceType: "PURCHASE" | "SALE" | "EXPENSE" | "PAYMENT",
  sourceId: string,
  amount: Prisma.Decimal,
  d: Date
) {
  const last = await tx.ledgerEntry.findFirst({
    where: { companyId, partyId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { runningBalance: true },
  });
  const prev = last?.runningBalance ?? dec(0);
  const delta = type === "DEBIT" ? amount : amount.negated();
  await tx.ledgerEntry.create({
    data: { companyId, partyId, type, sourceType, sourceId, amount, date: d, runningBalance: prev.add(delta) },
  });
}

// ---------- voucher builders ----------

type Line = { particular: string; qtyKg: number; pricePerKg: number };

async function purchase(
  companyId: string,
  type: PurchaseType,
  partyName: string,
  opts: { amount?: number; lines?: Line[]; paid: boolean },
  d: Date
) {
  await prisma.$transaction(async (tx) => {
    const partyId = await findOrCreateParty(tx, partyName, PURCHASE_SELLER_TYPE[type]);
    const lines = (opts.lines ?? []).map((l) => ({
      particular: l.particular,
      qtyKg: dec(l.qtyKg),
      pricePerKg: dec(l.pricePerKg),
      total: dec(l.qtyKg).mul(dec(l.pricePerKg)),
    }));
    const amount = opts.lines
      ? lines.reduce((a, l) => a.add(l.total), dec(0))
      : dec(opts.amount!);
    const p = await tx.purchase.create({
      data: { companyId, partyId, type, amount, paid: opts.paid, date: d, lines: { create: lines } },
    });
    await postLedger(tx, companyId, partyId, "CREDIT", "PURCHASE", p.id, amount, d);
    if (opts.paid) await postLedger(tx, companyId, partyId, "DEBIT", "PAYMENT", p.id, amount, d);
  });
}

async function delivery(
  companyId: string,
  channel: DeliveryChannel,
  buyerName: string,
  vehicleNo: string,
  d: Date
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const partyId = await findOrCreateParty(tx, buyerName, CHANNEL_BUYER_TYPE[channel]);
    const note = await tx.deliveryNote.create({
      data: { companyId, partyId, channel, vehicleNo, date: d, status: "PENDING" },
    });
    return note.id;
  });
}

async function settle(noteId: string, amountReceived: number, d: Date) {
  await prisma.$transaction(async (tx) => {
    const note = await tx.deliveryNote.findUniqueOrThrow({ where: { id: noteId } });
    const amount = dec(amountReceived);
    const s = await tx.settlement.create({
      data: { deliveryNoteId: noteId, amountReceived: amount, date: d },
    });
    await postLedger(tx, note.companyId, note.partyId, "DEBIT", "SALE", s.id, amount, d);
    await postLedger(tx, note.companyId, note.partyId, "CREDIT", "PAYMENT", s.id, amount, d);
    await tx.deliveryNote.update({ where: { id: noteId }, data: { status: "SETTLED" } });
  });
}

function expenseVendorName(category: ExpenseCategory, details: Record<string, string>): string {
  if (category === "ICE") return details.plantName;
  if (category === "RENT") return details.vehicleNo;
  const labels: Record<ExpenseCategory, string> = {
    ICE: "Ice", LOADERS: "Loaders", LADIES: "Ladies", BATHA: "Batha", CANTEEN: "Canteen", RENT: "Rent",
  };
  return labels[category];
}

async function expense(
  companyId: string,
  category: ExpenseCategory,
  details: Record<string, string>,
  amount: number,
  paid: boolean,
  d: Date,
  notes?: string
) {
  await prisma.$transaction(async (tx) => {
    const vendor = expenseVendorName(category, details);
    const partyId = await findOrCreateParty(tx, vendor, "EXPENSE_VENDOR");
    const e = await tx.expense.create({
      data: { companyId, partyId, category, amount: dec(amount), paid, date: d, notes: notes ?? null, details },
    });
    await postLedger(tx, companyId, partyId, "CREDIT", "EXPENSE", e.id, dec(amount), d);
    if (paid) await postLedger(tx, companyId, partyId, "DEBIT", "PAYMENT", e.id, dec(amount), d);
  });
}

// details-shaped expense helpers
const ice = (plantName: string, blocks: number, ratePerBlock: number, vehicleNo: string) =>
  ({ details: { plantName, blocks: String(blocks), ratePerBlock: String(ratePerBlock), vehicleNo }, amount: blocks * ratePerBlock });
const boxes = (n: number, ratePerBox: number) =>
  ({ details: { boxes: String(n), ratePerBox: String(ratePerBox) }, amount: n * ratePerBox });
const rent = (vehicleNo: string, amount: number) =>
  ({ details: { vehicleNo, rent: String(amount) }, amount });

async function closeDay(companyId: string, d: Date) {
  await prisma.dayClose.create({ data: { companyId, date: d } });
}

// ---------- wipe & rebuild ----------

async function wipe() {
  await prisma.attachment.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.deliveryNote.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.purchaseLine.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.dayClose.deleteMany();
  await prisma.errorFlag.deleteMany();
  await prisma.party.deleteMany();
}

async function main() {
  console.log("Wiping transactional data…");
  await wipe();

  for (const name of ["BFM", "B2B"]) {
    await prisma.company.upsert({ where: { name }, update: {}, create: { name } });
  }
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const co = Object.fromEntries(companies.map((c) => [c.name, c.id])) as Record<string, string>;
  const BFM = co["BFM"];
  const B2B = co["B2B"];

  // ================= BFM =================
  // ---- Day 17 (closed) ----
  await purchase(BFM, "SOCIETY", "Suvarna Tara", { amount: 68500, paid: true }, d17);
  await purchase(BFM, "KFDC", "Matsya Kanya", { amount: 42000, paid: true }, d17);
  await purchase(BFM, "PRIVATE", "Sagar Raj", { amount: 55300, paid: false }, d17); // credit — still owed
  await purchase(BFM, "LOCAL", "Ramesh Kharvi", {
    lines: [
      { particular: "Bangda", qtyKg: 120, pricePerKg: 125 },
      { particular: "Anjal", qtyKg: 20, pricePerKg: 460 },
      { particular: "Tarli", qtyKg: 80, pricePerKg: 70 },
    ],
    paid: true,
  }, d17);

  const b_m17 = await delivery(BFM, "MARKET", "Kondatty", "KA-20-B-5521", d17);
  const b_f17 = await delivery(BFM, "FACTORY", "West Coast Marine", "KA-20-A-9087", d17);
  const b_mill17 = await delivery(BFM, "FISH_MILL", "Karavali Fishmeal", "KA-20-C-3311", d17);
  await settle(b_m17, 47500, d17);
  await settle(b_f17, 82300, d17);
  // b_mill17 left pending → settled next day

  await expense(BFM, "ICE", ice("Malpe Ice Plant", 40, 180, "KA-20-C-1234").details, ice("Malpe Ice Plant", 40, 180, "KA-20-C-1234").amount, true, d17);
  await expense(BFM, "LOADERS", boxes(150, 12).details, boxes(150, 12).amount, true, d17);
  await expense(BFM, "LADIES", boxes(120, 8).details, boxes(120, 8).amount, true, d17);
  await expense(BFM, "CANTEEN", {}, 850, true, d17);
  await expense(BFM, "BATHA", {}, 1500, true, d17, "Crew batha");
  await expense(BFM, "RENT", rent("KA-20-C-1234", 1000).details, 1000, true, d17);
  await closeDay(BFM, d17);

  // ---- Day 18 (closed) ----
  await purchase(BFM, "SOCIETY", "Suvarna Tara", { amount: 51200, paid: true }, d18);
  await purchase(BFM, "PRIVATE", "Sagar Raj", { amount: 38900, paid: true }, d18);
  await purchase(BFM, "LOCAL", "Ashok Salian", {
    lines: [
      { particular: "Bangda", qtyKg: 100, pricePerKg: 130 },
      { particular: "Prawns", qtyKg: 30, pricePerKg: 400 },
    ],
    paid: true,
  }, d18);

  const b_m18 = await delivery(BFM, "MARKET", "City Market Agent", "KA-20-B-7788", d18);
  const b_f18 = await delivery(BFM, "FACTORY", "Oceanic Foods", "KA-20-A-4432", d18);
  await settle(b_mill17, 39600, d18); // yesterday's fish-mill delivery settled today
  await settle(b_m18, 61400, d18);
  // b_f18 left pending → settled day 19

  await expense(BFM, "ICE", ice("Sri Durga Ice", 35, 185, "KA-20-C-1234").details, ice("Sri Durga Ice", 35, 185, "KA-20-C-1234").amount, true, d18);
  await expense(BFM, "LOADERS", boxes(140, 12).details, boxes(140, 12).amount, true, d18);
  await expense(BFM, "LADIES", boxes(110, 8).details, boxes(110, 8).amount, true, d18);
  await expense(BFM, "CANTEEN", {}, 900, true, d18);
  await expense(BFM, "RENT", rent("KA-20-C-1234", 1000).details, 1000, true, d18);
  await closeDay(BFM, d18);

  // ---- Day 19 (TODAY — left open) ----
  await purchase(BFM, "SOCIETY", "Matsya Kanya", { amount: 47800, paid: true }, d19);
  await purchase(BFM, "KFDC", "Suvarna Tara", { amount: 36500, paid: false }, d19); // today's credit purchase
  await purchase(BFM, "LOCAL", "Ramesh Kharvi", {
    lines: [
      { particular: "Bangda", qtyKg: 90, pricePerKg: 128 },
      { particular: "Tarli", qtyKg: 60, pricePerKg: 72 },
    ],
    paid: true,
  }, d19);

  const b_m19 = await delivery(BFM, "MARKET", "Kondatty", "KA-20-B-5521", d19);
  const b_f19 = await delivery(BFM, "FACTORY", "West Coast Marine", "KA-20-A-9087", d19);
  await settle(b_f18, 70200, d19); // yesterday's factory delivery settled today
  await settle(b_m19, 52600, d19);
  // b_f19 left pending (today's dispatch)

  await expense(BFM, "ICE", ice("Malpe Ice Plant", 38, 180, "KA-20-C-1234").details, ice("Malpe Ice Plant", 38, 180, "KA-20-C-1234").amount, true, d19);
  await expense(BFM, "LOADERS", boxes(130, 12).details, boxes(130, 12).amount, true, d19);
  await expense(BFM, "CANTEEN", {}, 800, true, d19);
  await expense(BFM, "BATHA", {}, 1200, true, d19);
  await expense(BFM, "RENT", rent("KA-20-C-1234", 1000).details, 1000, true, d19);
  // day 19 NOT closed

  // ================= B2B (lighter operation) =================
  // ---- Day 17 (closed) ----
  await purchase(B2B, "SOCIETY", "Matsya Kanya", { amount: 44000, paid: true }, d17);
  await purchase(B2B, "LOCAL", "Ashok Salian", {
    lines: [
      { particular: "Bangda", qtyKg: 80, pricePerKg: 122 },
      { particular: "Anjal", qtyKg: 15, pricePerKg: 455 },
    ],
    paid: true,
  }, d17);
  const c_f17 = await delivery(B2B, "FACTORY", "Oceanic Foods", "KA-19-A-2201", d17);
  const c_m17 = await delivery(B2B, "MARKET", "City Market Agent", "KA-19-B-3302", d17);
  await settle(c_f17, 58900, d17);
  // c_m17 pending → settled day 18
  await expense(B2B, "ICE", ice("Sri Durga Ice", 20, 185, "KA-19-C-1111").details, ice("Sri Durga Ice", 20, 185, "KA-19-C-1111").amount, true, d17);
  await expense(B2B, "LOADERS", boxes(80, 12).details, boxes(80, 12).amount, true, d17);
  await expense(B2B, "CANTEEN", {}, 600, true, d17);
  await expense(B2B, "RENT", rent("KA-19-C-1111", 800).details, 800, true, d17);
  await closeDay(B2B, d17);

  // ---- Day 18 (closed) ----
  await purchase(B2B, "PRIVATE", "Sagar Raj", { amount: 33500, paid: true }, d18);
  await purchase(B2B, "LOCAL", "Ramesh Kharvi", {
    lines: [{ particular: "Prawns", qtyKg: 25, pricePerKg: 410 }],
    paid: false, // unpaid — stays on the seller ledger
  }, d18);
  const c_mill18 = await delivery(B2B, "FISH_MILL", "Karavali Fishmeal", "KA-19-C-8080", d18);
  await settle(c_m17, 47800, d18); // yesterday's market delivery settled today
  await settle(c_mill18, 41200, d18);
  await expense(B2B, "ICE", ice("Sri Durga Ice", 22, 185, "KA-19-C-1111").details, ice("Sri Durga Ice", 22, 185, "KA-19-C-1111").amount, true, d18);
  await expense(B2B, "LADIES", boxes(70, 8).details, boxes(70, 8).amount, true, d18);
  await expense(B2B, "CANTEEN", {}, 650, true, d18);
  await expense(B2B, "RENT", rent("KA-19-C-1111", 800).details, 800, true, d18);
  await closeDay(B2B, d18);

  // ---- Day 19 (TODAY — left open) ----
  await purchase(B2B, "SOCIETY", "Matsya Kanya", { amount: 39900, paid: true }, d19);
  await purchase(B2B, "LOCAL", "Ashok Salian", {
    lines: [{ particular: "Bangda", qtyKg: 70, pricePerKg: 126 }],
    paid: true,
  }, d19);
  const c_f19 = await delivery(B2B, "FACTORY", "Oceanic Foods", "KA-19-A-2201", d19);
  const c_m19 = await delivery(B2B, "MARKET", "Kondatty", "KA-19-B-3302", d19);
  await settle(c_m19, 44300, d19);
  // c_f19 left pending (today's dispatch)
  await expense(B2B, "ICE", ice("Sri Durga Ice", 24, 180, "KA-19-C-1111").details, ice("Sri Durga Ice", 24, 180, "KA-19-C-1111").amount, true, d19);
  await expense(B2B, "LOADERS", boxes(90, 12).details, boxes(90, 12).amount, true, d19);
  await expense(B2B, "CANTEEN", {}, 700, true, d19);
  await expense(B2B, "RENT", rent("KA-19-C-1111", 800).details, 800, true, d19);
  // day 19 NOT closed

  console.log("Seed complete: 3 days (17–19 Jul 2026) for BFM & B2B.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
