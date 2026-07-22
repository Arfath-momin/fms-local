// Seed: companies, users, and a small set of sample entries for the simplified
// 3-module model (Purchase / Expense / Sale) so the app opens populated.
// Run with `npm run db:seed`. Re-runnable — it clears transactional data first.
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
  await prisma.settlement.deleteMany();
  await prisma.deliveryNote.deleteMany();
  await prisma.purchaseLine.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.errorFlag.deleteMany();
  await prisma.dayClose.deleteMany();
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
    partyId: string,
    type: LedgerEntryType,
    sourceType: LedgerSourceType,
    sourceId: string,
    amount: Prisma.Decimal,
    on: Date
  ) {
    const key = `${companyId}:${partyId}`;
    const prev = balances.get(key) ?? D(0);
    const running = type === "DEBIT" ? prev.add(amount) : prev.sub(amount);
    balances.set(key, running);
    await prisma.ledgerEntry.create({
      data: {
        companyId,
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

  // --- Purchases ---
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
    await ledger(bfm, partyId, "CREDIT", "PURCHASE", p.id, amount, on);
    if (paid) await ledger(bfm, partyId, "DEBIT", "PAYMENT", p.id, amount, on);
  }

  await purchase("SOCIETY", "Boat No. 12", D(45000), true, date("2026-07-20"));
  await purchase("KFDC", "Boat No. 7", D(32000), true, date("2026-07-21"));
  await purchase("PRIVATE", "Boat No. 12", D(18500), false, date("2026-07-21"));
  await purchase("LOCAL", "Ramesh", D(15000), true, date("2026-07-21"), [
    { particular: "Prawn", qtyKg: 20, pricePerKg: 450 },
    { particular: "Mackerel", qtyKg: 50, pricePerKg: 120 },
  ]);

  // --- Expenses ---
  async function expense(
    category: "ICE" | "LOADERS" | "LADIES" | "BATHA" | "CANTEEN" | "RENT",
    vendorName: string,
    amount: Prisma.Decimal,
    on: Date,
    details: Record<string, string> = {}
  ) {
    const partyId = await party(vendorName, "EXPENSE_VENDOR");
    const e = await prisma.expense.create({
      data: { companyId: bfm, partyId, category, amount, paid: true, date: on, details },
    });
    await ledger(bfm, partyId, "CREDIT", "EXPENSE", e.id, amount, on);
    await ledger(bfm, partyId, "DEBIT", "PAYMENT", e.id, amount, on);
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

  // --- Sales (delivery + settlement) ---
  async function sale(
    channel: "MARKET" | "FACTORY" | "FISH_MILL" | "LOCAL",
    buyerName: string,
    buyerType: PartyType,
    vehicleNo: string,
    on: Date,
    settledAmount?: Prisma.Decimal
  ) {
    const partyId = await party(buyerName, buyerType);
    const note = await prisma.deliveryNote.create({
      data: {
        companyId: bfm,
        partyId,
        channel,
        vehicleNo,
        date: on,
        status: settledAmount ? "SETTLED" : "PENDING",
      },
    });
    if (settledAmount) {
      const s = await prisma.settlement.create({
        data: {
          deliveryNoteId: note.id,
          amount: settledAmount,
          amountReceived: settledAmount,
          date: on,
        },
      });
      await ledger(bfm, partyId, "DEBIT", "SALE", s.id, settledAmount, on);
      await ledger(bfm, partyId, "CREDIT", "PAYMENT", s.id, settledAmount, on);
    }
  }

  await sale("FACTORY", "Coastal Exports", "FACTORY", "KA-05-9090", date("2026-07-20"), D(52000));
  await sale("MARKET", "City Market", "MARKET_BUYER", "KA-02-3131", date("2026-07-21"));

  console.log("Seeded BFM/B2B, users, and sample Purchase/Expense/Sale entries.");
  for (const u of users) console.log(`  ${u.email} / ${u.password} (${u.role})`);
}

main().finally(() => prisma.$disconnect());
