import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getActiveCompany, type CompanyInfo } from "@/lib/company";

const COOKIE_NAME = "fms_centre";

export type CentreInfo = { id: string; name: string; companyId: string };

/** All centres of a company, alphabetical. */
export async function getCentres(companyId: string): Promise<CentreInfo[]> {
  return prisma.centre.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, companyId: true },
  });
}

/**
 * The active centre within a company. The cookie only counts if it names a
 * centre that actually belongs to this company (switching company must not
 * leak the previous company's centre). Falls back to the first centre, or null
 * when the company has no centres yet.
 */
export async function getActiveCentre(
  companyId: string
): Promise<CentreInfo | null> {
  const centres = await getCentres(companyId);
  if (centres.length === 0) return null;
  const cookieId = (await cookies()).get(COOKIE_NAME)?.value;
  const active = centres.find((c) => c.id === cookieId);
  return active ?? centres[0];
}

export async function setActiveCentreCookie(centreId: string) {
  (await cookies()).set(COOKIE_NAME, centreId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

export type ActiveScope = { company: CompanyInfo; centre: CentreInfo };

/**
 * The full active scope for entry screens and centre-scoped queries. Every
 * transaction and ledger entry is keyed to (company, centre); a page that
 * needs to read or write centre-scoped data calls this. Throws when the active
 * company has no centre yet — the caller should send the user to Masters to
 * create one.
 */
export async function requireActiveScope(): Promise<ActiveScope> {
  const company = await getActiveCompany();
  const centre = await getActiveCentre(company.id);
  if (!centre) {
    throw new Error(
      `${company.name} has no centre yet. Add one under Masters → Centres before making entries.`
    );
  }
  return { company, centre };
}

/** Like requireActiveScope but returns null centre instead of throwing. */
export async function getActiveScope(): Promise<{
  company: CompanyInfo;
  centre: CentreInfo | null;
}> {
  const company = await getActiveCompany();
  const centre = await getActiveCentre(company.id);
  return { company, centre };
}
