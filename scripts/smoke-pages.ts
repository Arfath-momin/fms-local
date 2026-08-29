// Do the pages actually render?
//
// `npm run build` compiles every route and says nothing about whether one
// throws when it runs. The Fish Mill and Factory sale forms shipped broken
// through a clean build and a clean tsc: a derived value was declared below the
// helper that read it, so rendering threw "Cannot access X before
// initialization" — and only on those two channels, because only a weighed bill
// reached that branch. Market and Local were fine, which is exactly what makes
// this class of failure easy to miss.
//
// This fetches real pages with a real session and fails if any of them errors
// or comes back without the content it should have. It needs the dev server
// running, so it is not part of `npm test`:
//
//   npm run dev          (in one terminal)
//   npm run smoke        (in another)
import "dotenv/config";
import { SignJWT } from "jose";
import { prisma } from "../src/lib/db";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";

/** A page, and a string that proves it rendered rather than merely responded. */
const PAGES: { path: string; expect: string }[] = [
  { path: "/vouchers", expect: "Delivery Note" },
  { path: "/vouchers/sales/new?type=MARKET", expect: "Total Bill" },
  { path: "/vouchers/sales/new?type=FACTORY", expect: "Particular" },
  { path: "/vouchers/sales/new?type=FISH_MILL", expect: "Particular" },
  { path: "/vouchers/sales/new?type=LOCAL", expect: "Particular" },
  { path: "/vouchers/purchases/new", expect: "Purchase" },
  { path: "/vouchers/deliveries/new", expect: "Vehicle" },
  { path: "/vouchers/expenses/new", expect: "Expense" },
  { path: "/vouchers/crates/new", expect: "Crates" },
  { path: "/vouchers/reserve-collections/new", expect: "Collect" },
  { path: "/ledgers", expect: "Ledgers" },
  { path: "/ledgers/crates", expect: "Crates held" },
  { path: "/ledgers/boxes", expect: "Boxes by trip" },
  { path: "/ledgers/reserve", expect: "Reserve" },
  { path: "/ledgers/reserve?kind=CUTTING", expect: "Cutting" },
  { path: "/ledgers/outstanding", expect: "owe" },
  { path: "/reports", expect: "Report" },
];

async function main() {
  const user = await prisma.user.findFirst({
    where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) {
    console.error("No admin user to sign in as. Run the bootstrap first.");
    process.exit(1);
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("SESSION_SECRET is not set.");
    process.exit(1);
  }

  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("600s")
    .sign(new TextEncoder().encode(secret));

  let failed = 0;
  for (const page of PAGES) {
    let status = 0;
    let body = "";
    try {
      const res = await fetch(BASE + page.path, {
        headers: { cookie: `fms_session=${token}` },
        redirect: "manual",
      });
      status = res.status;
      body = await res.text();
    } catch (e) {
      console.log(`FAIL  ${page.path}  ${e instanceof Error ? e.message : e}`);
      failed++;
      continue;
    }

    // A thrown render still returns 200 in dev — Next serves the error overlay
    // — so the status alone proves nothing. The marker is what proves it.
    const threw = /before initialization|is not defined|is not a function/.test(
      body
    );
    const rendered = body.includes(page.expect);

    if (status !== 200 || threw || !rendered) {
      console.log(
        `FAIL  ${page.path}  http=${status}` +
          (threw ? "  threw-during-render" : "") +
          (rendered ? "" : `  missing:"${page.expect}"`)
      );
      failed++;
    } else {
      console.log(`ok    ${page.path}`);
    }
  }

  console.log(
    failed === 0
      ? `\nAll ${PAGES.length} pages rendered.`
      : `\n${failed} of ${PAGES.length} pages failed.`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
