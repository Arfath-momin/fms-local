// Dev sanity check: prints ledger entries.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const entries = await prisma.ledgerEntry.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      company: { select: { name: true } },
      party: { select: { name: true } },
    },
  });
  for (const e of entries) {
    console.log(
      [
        e.company.name,
        e.party.name,
        e.type,
        e.sourceType,
        e.amount.toString(),
        `bal=${e.runningBalance.toString()}`,
      ].join(" | ")
    );
  }
}

main().finally(() => prisma.$disconnect());
