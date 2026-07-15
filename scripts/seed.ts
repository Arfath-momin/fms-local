// Seed: the two companies (BFM, B2B) and one user per role.
// Run with `npm run db:seed` (idempotent — safe to re-run).
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  for (const name of ["BFM", "B2B"]) {
    await prisma.company.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const users = [
    {
      email: "merchant@fms.local",
      name: "Merchant",
      role: "MERCHANT" as const,
      password: "merchant123",
    },
    {
      email: "auditor@fms.local",
      name: "Auditor",
      role: "AUDITOR" as const,
      password: "auditor123",
    },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: await bcrypt.hash(u.password, 10),
      },
    });
  }

  console.log("Seeded companies BFM, B2B and users:");
  for (const u of users) console.log(`  ${u.email} / ${u.password} (${u.role})`);
}

main().finally(() => prisma.$disconnect());
