// Files every existing purchase, sale and expense into a lot, so the Lots
// report reads history as well as anything entered from today.
//
//   npx tsx scripts/backfill-lots.ts --dry
//   npx tsx scripts/backfill-lots.ts
//
// Each row joins the lot for its own (centre, date) — the same rule the purchase
// action applies going forward. That is right for purchases by definition, and
// the best available guess for sales and expenses: before lots existed nothing
// recorded which consignment they belonged to, so their own date is the only
// evidence there is. Sales of fish bought a day or two earlier will therefore
// land on the wrong lot until someone edits them; the alternative was leaving
// them out of every lot entirely, which is worse.
//
// Idempotent: only rows whose lot_id is still null are touched.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const dry = process.argv.includes("--dry");
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// Mirrors lotCodeFor() in src/lib/lot.ts. Kept as a copy rather than an import
// because that module is bundled for the app; a maintenance script pulling in
// the client-side graph is a worse trade than nine lines of duplication.
function lotCodeFor(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${dd}${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("error: DATABASE_URL is not set");
    process.exit(1);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // Cache of (company, centre, code) → lot id, so a thousand purchases on one
    // day cost one lookup rather than a thousand.
    const lotIds = new Map<string, string>();

    async function lotFor(companyId: string, centreId: string, date: Date) {
      const code = lotCodeFor(date);
      const key = `${companyId} ${centreId} ${code}`;
      const hit = lotIds.get(key);
      if (hit) return hit;

      const existing = await prisma.lot.findUnique({
        where: { companyId_centreId_code: { companyId, centreId, code } },
        select: { id: true },
      });
      if (existing) {
        lotIds.set(key, existing.id);
        return existing.id;
      }
      if (dry) {
        lotIds.set(key, `(new ${code})`);
        return `(new ${code})`;
      }
      const created = await prisma.lot.create({
        data: { companyId, centreId, code, openedOn: date, kind: "CONSIGNMENT" },
        select: { id: true },
      });
      lotIds.set(key, created.id);
      return created.id;
    }

    let total = 0;
    for (const table of ["purchase", "sale", "expense"] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = prisma[table] as any;
      const rows = await model.findMany({
        where: { lotId: null },
        select: { id: true, companyId: true, centreId: true, date: true },
        orderBy: { date: "asc" },
      });

      for (const r of rows) {
        const lotId = await lotFor(r.companyId, r.centreId, r.date);
        if (!dry) await model.update({ where: { id: r.id }, data: { lotId } });
      }
      console.log(`${table.padEnd(9)} ${rows.length} row(s)`);
      total += rows.length;
    }

    // Every centre gets its standing overhead lot, so rent has somewhere to go
    // the first time the expense form is opened.
    const centres = await prisma.centre.findMany({
      select: { id: true, companyId: true },
    });
    let overheads = 0;
    for (const c of centres) {
      const existing = await prisma.lot.findUnique({
        where: {
          companyId_centreId_code: {
            companyId: c.companyId,
            centreId: c.id,
            code: "GENERAL",
          },
        },
        select: { id: true },
      });
      if (existing) continue;
      if (!dry)
        await prisma.lot.create({
          data: {
            companyId: c.companyId,
            centreId: c.id,
            code: "GENERAL",
            openedOn: new Date("1970-01-01T00:00:00.000Z"),
            kind: "OVERHEAD",
          },
        });
      overheads++;
    }

    console.log(
      `\n${dry ? "[dry run] would file" : "filed"} ${total} row(s) into ` +
        `${lotIds.size} lot(s); ${overheads} General lot(s) ${dry ? "would be " : ""}created`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
