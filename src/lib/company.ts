import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

const COOKIE_NAME = "fms_company";

export type CompanyInfo = {
  id: string;
  name: string;
  /** Band and switcher colour; null falls back to the stylesheet default. */
  colour: string | null;
  /** Whether a letterhead logo has been uploaded, for the header and bills. */
  hasLogo: boolean;
};

/**
 * The companies the signed-in user may work in.
 *
 * BFM and B2B are separate businesses sharing one installation, so this is
 * filtered by the user's grants (see UserCompany) rather than being every
 * company in the table. SUPER_ADMIN is exempt — the system owner sees all of
 * them, and needs no grant rows to do it.
 *
 * Memoised per request: getActiveCompany() calls this, and so does the layout
 * to render the switcher, which without cache() is the same query twice on
 * every navigation. getSession() is itself memoised, so the extra lookup this
 * now depends on costs nothing after the first call.
 */
export const getCompanies = cache(async function getCompanies(): Promise<
  CompanyInfo[]
> {
  const session = await getSession();
  if (!session) return [];

  const rows = await prisma.company.findMany({
    where: canSeeAllCompanies(session.role)
      ? undefined
      : { users: { some: { userId: session.userId } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, colour: true, logoKey: true },
  });

  // logoKey is reduced to a boolean: callers only need to know whether to
  // render an <img>, and the bytes are fetched through /api/company-logo/[id]
  // rather than travelling with every page render.
  return rows.map(({ logoKey, ...c }) => ({ ...c, hasLogo: logoKey !== null }));
});

/** Super admins are never filtered by company grants. */
const canSeeAllCompanies = (role: Role) => role === "SUPER_ADMIN";

/**
 * The active company scopes every query and every entry (spec §2: everything
 * is scoped by company_id except the Party master).
 *
 * This is the enforcement point for company isolation, not just a convenience.
 * The cookie is attacker-controlled — it is only honoured when it names a
 * company the user actually holds, and otherwise falls back to one they do.
 * Because every company-scoped screen resolves its scope through here, a user
 * granted only B2B cannot reach BFM data by editing a cookie, guessing a URL,
 * or keeping a stale session from before their access changed.
 *
 * Throws when the user holds nothing at all. That is a misconfiguration rather
 * than a normal state — createUser and setUserCompanies both refuse to leave an
 * account with no company — and it is caught by the app layout, which shows the
 * "no company" screen instead of a stack trace.
 */
export async function getActiveCompany(): Promise<CompanyInfo> {
  const companies = await getCompanies();
  if (companies.length === 0) throw new NoCompanyAccessError();

  const cookieId = (await cookies()).get(COOKIE_NAME)?.value;
  const active = companies.find((c) => c.id === cookieId);
  return active ?? companies.find((c) => c.name === "BFM") ?? companies[0];
}

/** Thrown when a signed-in account has been granted no company at all. */
export class NoCompanyAccessError extends Error {
  constructor() {
    super("This account has not been given access to any company.");
    this.name = "NoCompanyAccessError";
  }
}

export async function setActiveCompanyCookie(companyId: string) {
  (await cookies()).set(COOKIE_NAME, companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}
