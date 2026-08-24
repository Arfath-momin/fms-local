// Brings an EMPTY database up to the minimum the app needs to be usable:
// the companies, and one super admin to sign in as. Nothing else — no centres,
// no parties, no vouchers, no other logins.
//
//   npx tsx scripts/bootstrap.ts --email you@example.com --name "Your Name"
//   npx tsx scripts/bootstrap.ts --email you@example.com --name "Your Name" \
//     --companies "BFM,B2B"
//
// Unlike db:seed this creates NO transactional data and NO published-password
// accounts, so it is safe to run on a live server. It is also idempotent:
// companies are upserted by name, and an existing account is left alone unless
// --update is passed.
//
// Why this exists: it solves the chicken-and-egg of an empty database. Further
// companies are added in the app under Companies (super admin only), but that
// screen needs someone signed in to reach it, and a signed-in user needs a
// company to be put into — getActiveCompany() refuses an account holding none.
// So the FIRST company and the FIRST super admin have to come from the shell.
// Everything after that is done in the app.
import "dotenv/config";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { MIN_PASSWORD_LENGTH } from "../src/lib/password";
import { COMPANY_COLOURS } from "../src/lib/company-theme";

const BCRYPT_COST = 12;
const DEFAULT_COMPANIES = ["BFM", "B2B"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function generatePassword(): string {
  // Ambiguous characters removed — these get read aloud and retyped.
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 20; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const update = flag("update");
  const companyNames = (arg("companies") ?? DEFAULT_COMPANIES.join(","))
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail("--email is required and must look like an email address");
  if (!name) fail('--name is required, e.g. --name "Arfath"');
  if (companyNames.length === 0) fail("--companies cannot be empty");

  let password = arg("password") ?? process.env.FMS_USER_PASSWORD;
  const generated = !password;
  if (generated) password = generatePassword();
  if (password!.length < MIN_PASSWORD_LENGTH)
    fail(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);

  if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // Loud, because running this against a database that still has data is
    // almost always a mistake — and one that is hard to notice afterwards.
    const [purchases, sales, expenses, users] = await Promise.all([
      prisma.purchase.count(),
      prisma.sale.count(),
      prisma.expense.count(),
      prisma.user.count(),
    ]);
    const existingRows = purchases + sales + expenses;
    if (existingRows > 0)
      console.log(
        `note: database already holds ${existingRows} voucher(s). Nothing is ` +
          `deleted by this script — it only adds what is missing.\n`
      );

    // Each company gets a distinct colour so the band and switcher tell them
    // apart on sight. The rest of the letterhead — address, phone, GSTIN,
    // logo — is filled in from Companies inside the app, which is also where
    // any further company is added; this script only has to produce enough for
    // someone to sign in.
    for (const [i, companyName] of companyNames.entries()) {
      const existing = await prisma.company.findUnique({
        where: { name: companyName },
        select: { id: true, colour: true },
      });
      const colour = COMPANY_COLOURS[i % COMPANY_COLOURS.length].value;
      const c = existing
        ? await prisma.company.update({
            where: { id: existing.id },
            // An existing colour is somebody's decision — never overwritten.
            data: existing.colour ? {} : { colour },
            select: { id: true, colour: true },
          })
        : await prisma.company.create({
            data: { name: companyName, colour },
            select: { id: true, colour: true },
          });
      console.log(`company  ${companyName.padEnd(10)} ${c.colour}  ${c.id}`);
    }

    // --- standing party accounts -------------------------------------------
    //
    // A migration (20260804110100_purchase_group_ledgers) inserts four
    // PURCHASE_GROUP parties into every database. Two are still the real thing;
    // two are retired shared buckets from before each seller got their own
    // ledger, and on a fresh install they are clutter in the Purchase Parties
    // master — empty accounts nothing will ever post to.
    //
    // Society and KFDC are stamped with their purchase kind so the purchase
    // form filters suggestions correctly from the first bill, rather than
    // waiting for backfill-party-kind to be run.
    for (const [name, kind] of [
      ["Society", "SOCIETY"],
      ["KFDC", "KFDC"],
    ] as const) {
      const updated = await prisma.party.updateMany({
        where: { name, type: "PURCHASE_GROUP", purchaseKind: null },
        data: { purchaseKind: kind },
      });
      if (updated.count > 0) console.log(`party    ${name.padEnd(10)} → ${kind}`);
    }

    // Removed only when nothing references them — the same rule the app's own
    // delete uses. On a database with history they stay, because old vouchers
    // and ledger entries still resolve their names through these rows.
    for (const name of ["Private Parties", "Local Individuals"]) {
      const party = await prisma.party.findFirst({
        where: { name, type: "PURCHASE_GROUP" },
        select: {
          id: true,
          _count: {
            // Every relation Party actually has. Miss one and this deletes a
            // party something still points at. `purchasesAsBoat` used to be
            // here and is gone with Purchase.boatId — the boat is recorded per
            // LINE now, not per bill.
            select: {
              purchases: true,
              purchaseLinesAsBoat: true,
              expenses: true,
              ledgerEntries: true,
              salesAsBuyer: true,
              salesAsCareOf: true,
              settlements: true,
              vehicles: true,
              reserveCollections: true,
            },
          },
        },
      });
      if (!party) continue;
      const refs = Object.values(party._count).reduce((a, b) => a + b, 0);
      if (refs > 0) {
        console.log(`party    ${name} kept — ${refs} record(s) reference it`);
        continue;
      }
      await prisma.party.delete({ where: { id: party.id } });
      console.log(`party    ${name} removed (retired, unused)`);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && !update)
      fail(`${email} already exists — pass --update to reset its password`);

    const passwordHash = await bcrypt.hash(password!, BCRYPT_COST);
    const user = existing
      ? await prisma.user.update({
          where: { email },
          data: { passwordHash, role: "SUPER_ADMIN", name, isActive: true },
          select: { id: true },
        })
      : await prisma.user.create({
          data: { email, name, role: "SUPER_ADMIN", passwordHash },
          select: { id: true },
        });

    // A super admin is never filtered by company grants, so rows here are not
    // strictly required — they are created anyway so the Users screen shows the
    // account consistently with everyone else.
    const companies = await prisma.company.findMany({ select: { id: true } });
    await prisma.userCompany.createMany({
      data: companies.map((c) => ({ userId: user.id, companyId: c.id })),
      skipDuplicates: true,
    });

    console.log(
      `\n${existing ? "updated" : "created"} ${email} (SUPER_ADMIN)` +
        `  ·  ${users} user(s) existed before this`
    );
    if (generated) {
      console.log(`\n  password: ${password}\n`);
      console.log("Shown once and not stored anywhere. Save it now.");
    }
    console.log(
      "\nNext, in the app:\n" +
        "  Companies      fill in address, phone, GSTIN and logo for the bill head\n" +
        "  Masters → Centres   add the first centre (nothing can be entered without one)\n" +
        "  Users          add the team and grant them companies"
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
