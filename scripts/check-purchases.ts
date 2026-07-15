// Dev sanity check: prints purchases with company names.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const rows = await prisma.purchase.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      company: { select: { name: true } },
      party: { select: { name: true } },
    },
  });
  for (const r of rows) {
    console.log(
      [
        r.company.name,
        r.invoiceNumber,
        r.party.name,
        r.type,
        r.fishType,
        r.qtyKg.toString(),
        r.amount.toString(),
        r.createdAt.toISOString(),
      ].join(" | ")
    );
  }
}

main().finally(() => prisma.$disconnect());
