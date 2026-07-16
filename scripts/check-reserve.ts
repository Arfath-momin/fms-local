// Dev sanity check: delivery note statuses and owner reserve entries.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const notes = await prisma.deliveryNote.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      company: { select: { name: true } },
      _count: { select: { settlements: true } },
    },
  });
  for (const n of notes) {
    console.log(
      [
        n.company.name,
        n.channel,
        n.fishType,
        `${n.qtySent} kg @ ${n.rate}`,
        n.status,
        `${n._count.settlements} settlements`,
      ].join(" | ")
    );
  }
  const reserves = await prisma.ownerReserveEntry.findMany({
    include: { company: { select: { name: true } } },
  });
  console.log("owner reserve entries:", reserves.length);
  for (const r of reserves) {
    console.log(
      [r.company.name, r.amount.toString(), `bal=${r.runningBalance}`].join(" | ")
    );
  }
}

main().finally(() => prisma.$disconnect());
