// Fills in parties.purchase_kind from the purchases that already name each
// party, so the narrowed suggestions work against existing data instead of only
// against bills entered from today.
//
//   npx tsx scripts/backfill-party-kind.ts --dry
//   npx tsx scripts/backfill-party-kind.ts
//
// Idempotent: it only ever writes a party whose kind is still null, so running
// it twice changes nothing the second time. It also never overrules a kind set
// through ordinary use.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PurchaseType } from "../src/generated/prisma/enums";

const dry = process.argv.includes("--dry");

// Society and KFDC are standing accounts named by the purchase type itself
// (see FIXED_PURCHASE_PARTY in src/lib/party.ts), so their kind is known from
// the name and does not need to be inferred from history.
const FIXED: Record<string, PurchaseType> = {
  Society: "SOCIETY",
  KFDC: "KFDC",
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("error: DATABASE_URL is not set");
    process.exit(1);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const parties = await prisma.party.findMany({
      where: { type: "PURCHASE_GROUP", purchaseKind: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    if (parties.length === 0) {
      console.log("nothing to do — every purchase party already has a kind");
      return;
    }

    // One grouped query for every party at once rather than a query per party:
    // this is a maintenance script, but a few thousand sellers would still turn
    // the naive version into a few thousand round trips.
    const counts = await prisma.purchase.groupBy({
      by: ["partyId", "type"],
      where: { partyId: { in: parties.map((p) => p.id) } },
      _count: { _all: true },
    });

    // The kind a party appears under most often wins. A seller who turns up on
    // one Local bill and forty Private ones belongs with the private sellers,
    // and a single mis-keyed bill should not decide it.
    const best = new Map<string, { type: PurchaseType; n: number }>();
    for (const c of counts) {
      const cur = best.get(c.partyId);
      if (!cur || c._count._all > cur.n)
        best.set(c.partyId, { type: c.type, n: c._count._all });
    }

    let set = 0;
    let skipped = 0;
    for (const p of parties) {
      const kind = FIXED[p.name] ?? best.get(p.id)?.type;
      if (!kind) {
        // Never bought from — a party added by hand and not yet used. Left null
        // so it shows under every kind until a purchase files it.
        skipped++;
        continue;
      }
      console.log(`  ${p.name.padEnd(30)} → ${kind}`);
      if (!dry)
        await prisma.party.update({
          where: { id: p.id },
          data: { purchaseKind: kind },
        });
      set++;
    }

    console.log(
      `\n${dry ? "[dry run] would set" : "set"} ${set} of ${parties.length}` +
        `; ${skipped} left null (no purchase names them yet)`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
