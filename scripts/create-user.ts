// Creates or updates a single login account. Unlike `db:seed`, this touches
// nothing else — no companies, no vouchers, no ledger entries — so it is the
// only safe way to manage accounts on a live system.
//
//   npx tsx scripts/create-user.ts --email a@b.com --name "Asif" --role ADMIN
//   npx tsx scripts/create-user.ts --email a@b.com --role AUDITOR --update
//   npx tsx scripts/create-user.ts --email me@b.com --name "Me" --role SUPER_ADMIN
//
// Omit --password and a strong one is generated and printed once. Supply your
// own with --password or the FMS_USER_PASSWORD environment variable (the env
// var keeps it out of your shell history).
import "dotenv/config";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// SUPER_ADMIN is listed here and nowhere else. The Users screen deliberately
// cannot grant it, so this script — which needs shell access to the server — is
// the only way one comes into existence.
const ROLES = ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "AUDITOR"] as const;
type RoleName = (typeof ROLES)[number];

const MIN_PASSWORD_LENGTH = 12;
// Cost is stored inside the hash, so this can differ from older rows without
// breaking bcrypt.compare() at login.
const BCRYPT_COST = 12;

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
  const role = arg("role")?.trim().toUpperCase() as RoleName | undefined;
  const update = flag("update");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail("--email is required and must look like an email address");
  if (!role || !ROLES.includes(role))
    fail(`--role is required and must be one of: ${ROLES.join(", ")}`);

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
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && !update)
      fail(`${email} already exists — pass --update to change it`);
    if (!existing && !name) fail("--name is required when creating a new user");

    const passwordHash = await bcrypt.hash(password!, BCRYPT_COST);

    let userId: string;
    if (existing) {
      const u = await prisma.user.update({
        where: { email },
        data: { passwordHash, role, ...(name ? { name } : {}) },
        select: { id: true },
      });
      userId = u.id;
      console.log(`updated ${email} (${role})`);
    } else {
      const u = await prisma.user.create({
        data: { email, name: name!, role, passwordHash },
        select: { id: true },
      });
      userId = u.id;
      console.log(`created ${email} (${role})`);
    }

    // Grant every company, unless this account already holds some.
    //
    // Without a grant, getActiveCompany() refuses the user and they land on the
    // "no company access" screen — an account created here would look broken
    // rather than new. Granting everything and letting an admin narrow it from
    // the Users screen is the safe default; narrowing an existing account's
    // access from this script would silently undo that admin's decision, which
    // is why held grants are left alone.
    const held = await prisma.userCompany.count({ where: { userId } });
    if (held === 0) {
      const companies = await prisma.company.findMany({ select: { id: true } });
      if (companies.length > 0) {
        await prisma.userCompany.createMany({
          data: companies.map((c) => ({ userId, companyId: c.id })),
          skipDuplicates: true,
        });
        console.log(`granted ${companies.length} company/companies`);
      } else {
        // A super admin is never filtered by grants, so this is only a problem
        // for the roles that are.
        console.log(
          role === "SUPER_ADMIN"
            ? "no companies exist yet — a super admin sees every company anyway"
            : "WARNING: no companies exist yet. Create one, then re-run with " +
                "--update, or this account will have no access."
        );
      }
    }

    if (generated) {
      console.log(`\n  password: ${password}\n`);
      console.log("Shown once and not stored anywhere. Save it now.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
