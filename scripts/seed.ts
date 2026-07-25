// Seed: companies, centres, users, and sample entries for the 3-module model
// (Purchase / Expense / Sale). Every transaction and ledger entry is scoped to
// a (company, centre). Run with `npm run db:seed`. Re-runnable — it clears
// transactional data first.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import type {
  PartyType,
  LedgerEntryType,
  LedgerSourceType,
} from "../src/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const D = (v: number | string) => new Prisma.Decimal(v);
const date = (s: string) => new Date(s);

async function main() {
  // --- clear transactional data (idempotent re-run) ---
  await prisma.ledgerEntry.deleteMany();
  await prisma.saleLine.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.deliveryNoteLine.deleteMany();
  await prisma.deliveryNote.deleteMany();
  await prisma.purchaseLine.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.errorFlag.deleteMany();
  await prisma.dayClose.deleteMany();
  await prisma.centre.deleteMany();
  await prisma.party.deleteMany();

  // --- companies ---
  const companies: Record<string, string> = {};
  for (const name of ["BFM", "B2B"]) {
    const c = await prisma.company.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    companies[name] = c.id;
  }

  // --- centres (each company gets two isolated centres) ---
  const centres: Record<string, string> = {}; // key: `${company}:${centreName}`
  for (const companyName of ["BFM", "B2B"]) {
    for (const centreName of ["Centre 1", "Centre 2"]) {
      const centre = await prisma.centre.create({
        data: { companyId: companies[companyName], name: centreName },
      });
      centres[`${companyName}:${centreName}`] = centre.id;
    }
  }

  // --- users ---
  const users = [
    { email: "merchant@fms.local", name: "Merchant", role: "MERCHANT" as const, password: "merchant123" },
    { email: "auditor@fms.local", name: "Auditor", role: "AUDITOR" as const, password: "auditor123" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: await bcrypt.hash(u.password, 10),
      },
    });
  }

  // --- helpers ---
  const partyCache = new Map<string, string>();
  async function party(name: string, type: PartyType): Promise<string> {
    const key = `${type}:${name}`;
    const hit = partyCache.get(key);
    if (hit) return hit;
    const p = await prisma.party.upsert({
      where: { name_type: { name, type } },
      update: {},
      create: { name, type },
    });
    partyCache.set(key, p.id);
    return p.id;
  }

  const balances = new Map<string, Prisma.Decimal>();
  async function ledger(
    companyId: string,
    centreId: string,
    partyId: string,
    type: LedgerEntryType,
    sourceType: LedgerSourceType,
    sourceId: string,
    amount: Prisma.Decimal,
    on: Date
  ) {
    const key = `${companyId}:${centreId}:${partyId}`;
    const prev = balances.get(key) ?? D(0);
    const running = type === "DEBIT" ? prev.add(amount) : prev.sub(amount);
    balances.set(key, running);
    await prisma.ledgerEntry.create({
      data: {
        companyId,
        centreId,
        partyId,
        type,
        sourceType,
        sourceId,
        amount,
        date: on,
        runningBalance: running,
      },
    });
  }

  const bfm = companies["BFM"];
  const c1 = centres["BFM:Centre 1"];

  // --- Purchases (BFM · Centre 1) ---
  async function purchase(
    type: "SOCIETY" | "KFDC" | "PRIVATE" | "LOCAL",
    partyName: string,
    amount: Prisma.Decimal,
    paid: boolean,
    on: Date,
    lines: { particular: string; qtyKg: number; pricePerKg: number }[] = []
  ) {
    const partyType: PartyType = type === "LOCAL" ? "LOCAL_SELLER" : "BOAT";
    const partyId = await party(partyName, partyType);
    const p = await prisma.purchase.create({
      data: {
        companyId: bfm,
        centreId: c1,
        partyId,
        type,
        amount,
        paid,
        date: on,
        lines: {
          create: lines.map((l) => ({
            particular: l.particular,
            qtyKg: D(l.qtyKg),
            pricePerKg: D(l.pricePerKg),
            total: D(l.qtyKg).mul(D(l.pricePerKg)),
          })),
        },
      },
    });
    await ledger(bfm, c1, partyId, "CREDIT", "PURCHASE", p.id, amount, on);
    if (paid) await ledger(bfm, c1, partyId, "DEBIT", "PAYMENT", p.id, amount, on);
  }

  await purchase("SOCIETY", "Boat No. 12", D(45000), true, date("2026-07-20"));
  await purchase("KFDC", "Boat No. 7", D(32000), true, date("2026-07-21"));
  await purchase("PRIVATE", "Boat No. 12", D(18500), false, date("2026-07-21"));
  await purchase("LOCAL", "Ramesh", D(15000), true, date("2026-07-21"), [
    { particular: "Prawn", qtyKg: 20, pricePerKg: 450 },
    { particular: "Mackerel", qtyKg: 50, pricePerKg: 120 },
  ]);

  // --- Expenses (BFM · Centre 1) ---
  async function expense(
    category: "ICE" | "LOADERS" | "LADIES" | "BATHA" | "CANTEEN" | "RENT",
    vendorName: string,
    amount: Prisma.Decimal,
    on: Date,
    details: Record<string, string> = {}
  ) {
    const partyId = await party(vendorName, "EXPENSE_VENDOR");
    const e = await prisma.expense.create({
      data: { companyId: bfm, centreId: c1, partyId, category, amount, paid: true, date: on, details },
    });
    await ledger(bfm, c1, partyId, "CREDIT", "EXPENSE", e.id, amount, on);
    await ledger(bfm, c1, partyId, "DEBIT", "PAYMENT", e.id, amount, on);
  }

  await expense("ICE", "Sagar Ice", D(1500), date("2026-07-21"), {
    slNo: "1",
    vehicleNo: "KA-01-1234",
    plantName: "Sagar Ice",
    blocks: "10",
    ratePerBlock: "150",
  });
  await expense("LOADERS", "Loaders", D(2400), date("2026-07-21"), { boxes: "200", ratePerBox: "12" });
  await expense("LADIES", "Ladies", D(1600), date("2026-07-21"), { boxes: "200", ratePerBox: "8" });
  await expense("CANTEEN", "Canteen", D(800), date("2026-07-21"));
  await expense("RENT", "KA-09-5678", D(1000), date("2026-07-21"), { slNo: "1", vehicleNo: "KA-09-5678", rent: "1000" });

  // --- Sales (BFM · Centre 1) ---
  // Each sale posts to the buyer's (or CareOf's) ledger; received nets it,
  // any shortfall stays outstanding.
  async function factorySale(
    buyerName: string,
    billNo: string,
    amount: Prisma.Decimal,
    received: Prisma.Decimal,
    careOfName: string | null,
    on: Date
  ) {
    const buyerId = await party(buyerName, "FACTORY");
    const careOfId = careOfName ? await party(careOfName, "CARE_OF") : null;
    const s = await prisma.sale.create({
      data: {
        companyId: bfm,
        centreId: c1,
        type: "FACTORY",
        partyId: buyerId,
        careOfPartyId: careOfId,
        billNo,
        date: on,
        amount,
        amountReceived: received,
        vehicleNo: "KA-05-9090",
      },
    });
    const ledgerParty = careOfId ?? buyerId;
    await ledger(bfm, c1, ledgerParty, "DEBIT", "SALE", s.id, amount, on);
    if (received.gt(0))
      await ledger(bfm, c1, ledgerParty, "CREDIT", "PAYMENT", s.id, received, on);
  }

  async function marketSale(
    sellerName: string,
    billNo: string,
    totalBill: Prisma.Decimal,
    netBill: Prisma.Decimal,
    received: Prisma.Decimal,
    on: Date
  ) {
    const buyerId = await party(sellerName, "MARKET_BUYER");
    const s = await prisma.sale.create({
      data: {
        companyId: bfm,
        centreId: c1,
        type: "MARKET",
        partyId: buyerId,
        billNo,
        date: on,
        amount: netBill,
        amountReceived: received,
        place: "City Market",
        totalBill,
        commission: totalBill.mul(0.02),
      },
    });
    await ledger(bfm, c1, buyerId, "DEBIT", "SALE", s.id, netBill, on);
    if (received.gt(0))
      await ledger(bfm, c1, buyerId, "CREDIT", "PAYMENT", s.id, received, on);
  }

  await factorySale("Coastal Exports", "F-1001", D(52000), D(52000), null, date("2026-07-20"));
  await factorySale("Bay Foods", "F-1002", D(38000), D(20000), "Fayaz", date("2026-07-21"));
  await marketSale("City Market", "M-2001", D(100000), D(92000), D(50000), date("2026-07-21"));

  // --- Delivery note (record only, BFM · Centre 1) ---
  await prisma.deliveryNote.create({
    data: {
      companyId: bfm,
      centreId: c1,
      billNo: "DN-3001",
      date: date("2026-07-21"),
      recipient: "City Market",
      vehicleNo: "KA-02-3131",
      advancePaid: D(2000),
      driverName: "Suresh",
      mobileNo: "9876543210",
      lines: {
        create: [
          { particulars: "Prawn", kg: D(120), box: 10, bigBox: 2, loose: 3, pcs: 0 },
          { particulars: "Mackerel", kg: D(200), box: 15, bigBox: 0, loose: 5, pcs: 0 },
        ],
      },
    },
  });

  console.log("Seeded BFM/B2B, two centres each, users, and sample entries in BFM · Centre 1.");
  for (const u of users) console.log(`  ${u.email} / ${u.password} (${u.role})`);
}

main().finally(() => prisma.$disconnect());
