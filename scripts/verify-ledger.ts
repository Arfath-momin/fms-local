// Ledger integrity audit.
//
// Recomputes every party's running balance from its own entries and reports
// any row whose stored `running_balance` disagrees. In a correct system this
// always prints zero discrepancies: balances are derived, and every write path
// goes through recomputeRunningBalance() in src/lib/ledger.ts.
//
// Run it after a migration, a restore, or any bulk data change:
//   npm run db:verify
//
// Exits non-zero when anything is inconsistent, so it can gate a deploy.
import "dotenv/config";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const ZERO = new Prisma.Decimal(0);

async function main() {
  // Ordered exactly as the recompute window orders: (date, seq) per chain.
  const entries = await prisma.ledgerEntry.findMany({
    orderBy: [{ date: "asc" }, { seq: "asc" }],
    select: {
      id: true,
      date: true,
      type: true,
      amount: true,
      runningBalance: true,
      company: { select: { name: true } },
      centre: { select: { name: true } },
      party: { select: { name: true } },
      companyId: true,
      centreId: true,
      partyId: true,
    },
  });

  const running = new Map<string, Prisma.Decimal>();
  const bad: string[] = [];

  for (const e of entries) {
    const key = `${e.companyId}|${e.centreId}|${e.partyId}`;
    const prev = running.get(key) ?? ZERO;
    const expected =
      e.type === "DEBIT" ? prev.add(e.amount) : prev.sub(e.amount);
    running.set(key, expected);

    if (!expected.equals(e.runningBalance)) {
      bad.push(
        `${e.company.name} / ${e.centre.name} / ${e.party.name} ` +
          `${e.date.toISOString().slice(0, 10)} ${e.type} ${e.amount.toString()} — ` +
          `stored ${e.runningBalance.toString()}, expected ${expected.toString()}`
      );
    }
  }

  console.log(
    `Checked ${entries.length} ledger entries across ${running.size} party ledgers.`
  );

  if (bad.length === 0) {
    console.log("OK — every running balance matches its entry chain.");
    return;
  }

  console.error(`\n${bad.length} inconsistent running balance(s):\n`);
  for (const line of bad.slice(0, 50)) console.error(`  ${line}`);
  if (bad.length > 50) console.error(`  ... and ${bad.length - 50} more`);
  console.error(
    "\nRepair by re-running the recompute for the affected ledgers."
  );
  process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
