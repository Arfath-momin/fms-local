// Dev sanity check: prints stock movements with company names.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const moves = await prisma.stockMovement.findMany({
    orderBy: { createdAt: "asc" },
    include: { company: { select: { name: true } } },
  });
  for (const m of moves) {
    console.log(
      [
        m.company.name,
        m.fishType,
        m.direction,
        m.state,
        m.sourceType,
        m.qtyKg.toString(),
      ].join(" | ")
    );
  }
}

main().finally(() => prisma.$disconnect());
