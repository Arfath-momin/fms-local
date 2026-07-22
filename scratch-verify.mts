import "dotenv/config";
import { PrismaClient } from "./src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const co = await prisma.company.findFirstOrThrow({ where: { name: "BFM" } });
const today = new Date("2026-07-19T00:00:00.000Z");
// EXACT query that threw the vehicle_no error on the dashboard:
const pending = await prisma.deliveryNote.findMany({
  where: { companyId: co.id, status: { not: "SETTLED" } },
  include: { party: { select: { name: true } } },
  orderBy: [{ date: "asc" }, { createdAt: "asc" }],
});
console.log("deliveryNote.findMany OK — pending:", pending.map(n => `${n.party.name}/${n.channel}/${n.vehicleNo}`).join(", ") || "none");
// Dashboard tile aggregates:
const pur = await prisma.purchase.aggregate({ where: { companyId: co.id, date: today }, _sum: { amount: true } });
const exp = await prisma.expense.aggregate({ where: { companyId: co.id, date: today }, _sum: { amount: true } });
const set = await prisma.settlement.findMany({ where: { date: today, deliveryNote: { companyId: co.id } }, select: { amountReceived: true } });
const sale = set.reduce((a, s) => a + Number(s.amountReceived), 0);
console.log(`Today tiles → purchase=${pur._sum.amount} expense=${exp._sum.amount} sale=${sale} profit=${sale - Number(pur._sum.amount) - Number(exp._sum.amount)}`);
// A LOCAL purchase with its lines (new model):
const local = await prisma.purchase.findFirst({ where: { companyId: co.id, type: "LOCAL" }, include: { lines: true, party: true } });
console.log(`LOCAL purchase by ${local?.party.name}: ${local?.lines.map(l=>`${l.particular} ${l.qtyKg}kg@${l.pricePerKg}`).join(", ")} = ${local?.amount}`);
await prisma.$disconnect();
