// One-time backfill: give every Local seller their own ledger.
//
// Local purchases used to post to a single shared "Local Individuals" account,
// so two sellers owed ₹40,000 and ₹50,000 read as one ₹90,000 debt that could
// not be paid to anybody. The seller's name was already recorded — on
// `purchases.boat_id`, as a registry-only LOCAL_SELLER — it simply had nowhere
// to post. This moves each Local purchase onto a PURCHASE_GROUP party named
// after that seller, which is exactly how Private purchases already worked.
//
//   npm run db:split-local -- --dry-run   report only, rolls back
//   npm run db:split-local                apply
//
// Safe to re-run: purchases already pointing at an individual seller are not
// matched, so a second run finds nothing to do.
//
// Settlements are deliberately NOT touched. A payment is recorded against a
// party, not against a bill (see the Settlement model), so a payment already
// booked to "Local Individuals" carries no evidence of which seller it settled.
// Splitting it would invent facts. Any such payments are listed at the end and
// have to be re-entered against the right seller by hand.
import "dotenv/config";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const LEGACY_PARTY_NAME = "Local Individuals";
const ZERO = new Prisma.Decimal(0);

type Scope = { companyId: string; centreId: string; partyId: string };

/**
 * Rebuild one ledger chain. Character-for-character the statement in
 * src/lib/ledger.ts — inlined only because that module imports "server-only",
 * which Next.js resolves and a plain tsx script cannot. If one changes, change
 * both.
 */
async function recompute(tx: Prisma.TransactionClient, s: Scope) {
  await tx.$executeRaw`
    WITH ordered AS (
      SELECT
        "id",
        SUM(CASE WHEN "type" = 'DEBIT' THEN "amount" ELSE -"amount" END)
          OVER (ORDER BY "date", "seq" ROWS UNBOUNDED PRECEDING) AS rb
      FROM "ledger_entries"
      WHERE "company_id" = ${s.companyId}
        AND "centre_id" = ${s.centreId}
        AND "party_id" = ${s.partyId}
    )
    UPDATE "ledger_entries" le
    SET "running_balance" = ordered.rb
    FROM ordered
    WHERE le."id" = ordered."id"
      AND le."running_balance" IS DISTINCT FROM ordered.rb
  `;
}

async function balanceOf(
  tx: Prisma.TransactionClient,
  s: Scope
): Promise<Prisma.Decimal> {
  const last = await tx.ledgerEntry.findFirst({
    where: s,
    orderBy: [{ date: "desc" }, { seq: "desc" }],
    select: { runningBalance: true },
  });
  return last?.runningBalance ?? ZERO;
}

const money = (v: Prisma.Decimal) =>
  (v.isNegative() ? "-" : "") +
  "₹" +
  v.abs().toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    dryRun
      ? "DRY RUN — every change below is rolled back.\n"
      : "APPLYING changes.\n"
  );

  await prisma
    .$transaction(async (tx) => {
      const legacy = await tx.party.findUnique({
        where: {
          name_type: { name: LEGACY_PARTY_NAME, type: "PURCHASE_GROUP" },
        },
        select: { id: true },
      });

      if (!legacy) {
        console.log(
          `No "${LEGACY_PARTY_NAME}" party exists — nothing to split.`
        );
        return;
      }

      const purchases = await tx.purchase.findMany({
        where: { type: "LOCAL", partyId: legacy.id, boatId: { not: null } },
        select: {
          id: true,
          companyId: true,
          centreId: true,
          amount: true,
          date: true,
          boat: { select: { id: true, name: true } },
        },
        orderBy: { date: "asc" },
      });

      if (purchases.length === 0) {
        console.log("No Local purchases are still pointing at the shared account.");
      }

      // Every chain the repoint touches — the sellers gaining entries and the
      // legacy account losing them. Recomputed once each at the end rather than
      // per purchase, so a seller with 40 bills is rebuilt once.
      const scopes = new Map<string, Scope>();
      const addScope = (s: Scope) =>
        scopes.set(`${s.companyId} ${s.centreId} ${s.partyId}`, s);

      // Name → new party id, so N purchases from one seller do one lookup.
      const sellerIds = new Map<string, string>();
      const moved = new Map<string, { count: number; total: Prisma.Decimal }>();

      for (const p of purchases) {
        const name = p.boat!.name.trim().replace(/\s+/g, " ");

        let sellerId = sellerIds.get(name);
        if (!sellerId) {
          const existing = await tx.party.findUnique({
            where: { name_type: { name, type: "PURCHASE_GROUP" } },
            select: { id: true },
          });
          sellerId =
            existing?.id ??
            (
              await tx.party.create({
                data: { name, type: "PURCHASE_GROUP" },
                select: { id: true },
              })
            ).id;
          sellerIds.set(name, sellerId);
        }

        await tx.purchase.update({
          where: { id: p.id },
          // The header boat is cleared: the seller is now the party, and
          // leaving the name in both places would print "Boat: Ravi" on Ravi's
          // own statement.
          data: { partyId: sellerId, boatId: null },
        });

        await tx.ledgerEntry.updateMany({
          where: { sourceType: "PURCHASE", sourceId: p.id },
          data: { partyId: sellerId },
        });

        addScope({ companyId: p.companyId, centreId: p.centreId, partyId: sellerId });
        addScope({ companyId: p.companyId, centreId: p.centreId, partyId: legacy.id });

        const seen = moved.get(name) ?? { count: 0, total: ZERO };
        moved.set(name, {
          count: seen.count + 1,
          total: seen.total.add(p.amount),
        });
      }

      for (const s of scopes.values()) await recompute(tx, s);

      // ---- Report -------------------------------------------------------
      if (moved.size > 0) {
        console.log(`Moved ${purchases.length} purchase(s) onto ${moved.size} seller ledger(s):\n`);
        const names = [...moved.keys()].sort((a, b) => a.localeCompare(b));
        for (const name of names) {
          const m = moved.get(name)!;
          console.log(
            `  ${name.padEnd(28)} ${String(m.count).padStart(3)} bill(s)   ${money(m.total)}`
          );
        }
        console.log();
      }

      // What is left on the shared account is exactly the settlements that
      // could not be attributed — every purchase has been moved off it.
      const leftovers = await tx.ledgerEntry.findMany({
        where: { partyId: legacy.id },
        select: {
          companyId: true,
          centreId: true,
          sourceType: true,
          sourceId: true,
          amount: true,
          date: true,
          company: { select: { name: true } },
          centre: { select: { name: true } },
        },
        orderBy: [{ date: "asc" }],
      });

      if (leftovers.length === 0) {
        console.log(`"${LEGACY_PARTY_NAME}" is now empty — nothing left to reconcile.`);
      } else {
        console.log(
          `${leftovers.length} entr(y/ies) remain on "${LEGACY_PARTY_NAME}" and need\n` +
            `re-entering against the right seller by hand:\n`
        );
        for (const e of leftovers) {
          console.log(
            `  ${e.date.toISOString().slice(0, 10)}  ${e.company.name} · ${e.centre.name}` +
              `  ${e.sourceType.padEnd(10)} ${money(e.amount)}  (${e.sourceId})`
          );
        }
        console.log();
        const scopesLeft = new Map<string, Scope>();
        for (const e of leftovers)
          scopesLeft.set(`${e.companyId} ${e.centreId}`, {
            companyId: e.companyId,
            centreId: e.centreId,
            partyId: legacy.id,
          });
        for (const s of scopesLeft.values()) {
          const bal = await balanceOf(tx, s);
          console.log(`  Remaining balance on the shared account: ${money(bal)}`);
        }
      }

      if (dryRun) throw new DryRun();
    })
    .catch((e) => {
      if (e instanceof DryRun) {
        console.log("\nDry run complete — rolled back, nothing was written.");
        return;
      }
      throw e;
    });
}

class DryRun extends Error {}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
