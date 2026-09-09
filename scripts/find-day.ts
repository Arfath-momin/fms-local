// Where a day's vouchers actually are.
//
// The Day Book answers for ONE company, ONE centre and ONE date, and says so
// when it finds nothing. When a merchant knows they traded that day, the
// vouchers are somewhere — and there are only three places they can be:
//
//   * another CENTRE (or company), if the active one was switched afterwards;
//   * another DATE, because `date` is the day the fish was BOUGHT, not the day
//     the voucher was typed (invariant 1) — a trip entered on the 7th for the
//     6th's catch belongs to the 6th and the Day Book is right to omit it;
//   * nowhere, and the entry was never saved.
//
// This reads the books and prints which. It writes nothing.
//
//   docker compose run --rm migrate npx tsx scripts/find-day.ts 2026-08-07
//
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const arg = process.argv[2];
if (!arg || !/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
  console.error("Usage: npx tsx scripts/find-day.ts YYYY-MM-DD");
  process.exit(2);
}
// The same instant the Day Book screen builds, so this asks the question the
// screen asked and not a slightly different one.
const target = new Date(`${arg}T00:00:00.000Z`);
const DAY = 86_400_000;
const span = 7;

type Counts = { purchases: number; sales: number; expenses: number };
const total = (c: Counts) => c.purchases + c.sales + c.expenses;

async function main() {
  const centres = await prisma.centre.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, company: { select: { name: true } } },
  });

  console.log(`\nEnvironment: TZ=${process.env.TZ ?? "(unset)"}`);
  console.log(`Asking for: ${arg}  (as ${target.toISOString()})\n`);

  // 1. That exact day, in EVERY centre — the commonest answer by far is that
  //    the vouchers are filed under a centre nobody has switched back to.
  console.log(`=== ${arg}, across every centre ===`);
  let foundSomewhere = false;
  for (const c of centres) {
    const where = { centreId: c.id, date: target };
    const [purchases, sales, expenses] = await Promise.all([
      prisma.purchase.count({ where }),
      prisma.sale.count({ where }),
      prisma.expense.count({ where }),
    ]);
    const n = total({ purchases, sales, expenses });
    if (n > 0) foundSomewhere = true;
    console.log(
      `  ${(c.company.name + " / " + c.name).padEnd(28)} ` +
        (n === 0
          ? "—"
          : `purchases ${purchases}  sales ${sales}  expenses ${expenses}`)
    );
  }

  if (!foundSomewhere)
    console.log(`\n  Nothing on ${arg} in ANY centre.`);

  // 2. The days either side. A voucher dated to the wrong buying day is the
  //    other way this happens, and it is always within a day or two.
  console.log(`\n=== the ${span * 2 + 1} days around ${arg} (all centres) ===`);
  for (let i = -span; i <= span; i++) {
    const d = new Date(target.getTime() + i * DAY);
    const key = d.toISOString().slice(0, 10);
    const where = { date: d };
    const [purchases, sales, expenses] = await Promise.all([
      prisma.purchase.count({ where }),
      prisma.sale.count({ where }),
      prisma.expense.count({ where }),
    ]);
    const n = total({ purchases, sales, expenses });
    if (n === 0) continue;
    console.log(
      `  ${key}${i === 0 ? "  <- asked for" : "".padEnd(14)}` +
        `  purchases ${purchases}  sales ${sales}  expenses ${expenses}`
    );
  }

  // 3. Proof the date column round-trips. If Postgres and the app disagreed
  //    about what a date is, every day would look empty, not just this one —
  //    so this line either rules that out or names it outright.
  const sample = await prisma.purchase.findFirst({
    orderBy: { date: "desc" },
    select: { date: true, billNo: true, centre: { select: { name: true } } },
  });
  console.log(
    `\nMost recent purchase in the books: ` +
      (sample
        ? `${sample.date.toISOString().slice(0, 10)} (${sample.centre.name}, bill ${sample.billNo ?? "—"})`
        : "none")
  );
  console.log(
    "If that date reads as the day you expect, the date column is fine and " +
      "the vouchers are under another centre or another buying day above.\n"
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
