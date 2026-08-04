import "server-only";
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

const COOKIE_NAME = "fms_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type Session = {
  userId: string;
  email: string;
  name: string;
  role: Role;
};

// ---------------------------------------------------------------------------
// Permission model — the single source of truth. Three roles:
//
//   ADMIN      everything, and the only role that may change an existing voucher
//   ACCOUNTANT enters vouchers and manages parties; cannot edit a voucher once
//              it is saved
//   AUDITOR    read-only; no voucher menu, reaches vouchers only by drilling
//              down from a ledger
//
// UI gating and server-side enforcement both read these, so a hidden button and
// a rejected action can never disagree.
// ---------------------------------------------------------------------------

/** May create vouchers, and add/edit parties. */
export const canEnter = (role: Role): boolean =>
  role === "ADMIN" || role === "ACCOUNTANT";

/** May change or correct a voucher that already exists. Admin only. */
export const canEdit = (role: Role): boolean => role === "ADMIN";

/** May manage users and centres. Admin only. */
export const canAdminister = (role: Role): boolean => role === "ADMIN";

/**
 * May read analytics — the dashboard, the reports section and the union view.
 *
 * Accountants are deliberately excluded. They enter vouchers and maintain
 * masters; turnover and profit figures are not part of that job. They keep
 * access to Ledgers, because knowing what a party currently owes is required
 * to record a payment or a receipt correctly.
 */
export const canViewReports = (role: Role): boolean =>
  role === "ADMIN" || role === "AUDITOR";

/**
 * The first screen a role is allowed to see. Used for sign-in and for the
 * bounce when someone reaches a page above their level, so nobody ever lands
 * on a route that immediately redirects again.
 */
export const landingPathFor = (role: Role): string =>
  canViewReports(role) ? "/dashboard" : "/vouchers";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function createSession(session: Session) {
  const token = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
}

/**
 * Verifies the cookie, then re-reads the account from the database.
 *
 * The extra lookup is deliberate. The cookie lives for seven days, so trusting
 * the role baked into it would mean a demoted user keeps admin rights, and a
 * deactivated user keeps working, until it expires. The database is
 * authoritative for both; a primary-key lookup is cheap enough to pay per
 * request for that guarantee.
 *
 * cache() makes that "per request" literal. The layout calls this and so does
 * every page inside it, which without memoisation is the same lookup two or
 * three times per navigation. React clears the cache between requests, so a
 * role change still takes effect on the very next one.
 */
export const getSession = cache(async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  let userId: string;
  try {
    const { payload } = await jwtVerify<Session>(token, secret());
    userId = payload.userId;
  } catch {
    return null;
  }
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
});

/** For pages/layouts: bounce to /login when unauthenticated. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * For actions that create something — vouchers, parties. Admin and Accountant.
 */
export async function requireEntry(): Promise<Session> {
  const session = await requireSession();
  if (!canEnter(session.role)) {
    throw new Error("Read-only account: auditors cannot make entries.");
  }
  return session;
}

/**
 * For actions that change something that already exists. Admin only — an
 * accountant may enter a voucher but never alter one afterwards.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (!canAdminister(session.role)) {
    throw new Error(
      "Only an administrator can change or remove an existing record."
    );
  }
  return session;
}

/**
 * For analytics pages — dashboard, reports, union. Redirects rather than
 * throwing: reaching one of these as an accountant is a navigation mistake,
 * not an attack, so the honest response is to put them on their own home
 * screen instead of showing an error.
 */
export async function requireReports(): Promise<Session> {
  const session = await requireSession();
  if (!canViewReports(session.role)) redirect(landingPathFor(session.role));
  return session;
}

export async function destroySession() {
  (await cookies()).delete(COOKIE_NAME);
}
