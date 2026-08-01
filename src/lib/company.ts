import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

const COOKIE_NAME = "fms_company";

export type CompanyInfo = { id: string; name: string };

// Memoised per request: getActiveCompany() below calls this, and the app layout
// calls both to render the switcher, which without cache() is the same query
// twice on every navigation.
export const getCompanies = cache(async function getCompanies(): Promise<
  CompanyInfo[]
> {
  return prisma.company.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
});

/**
 * The active company scopes every query and every entry (spec §2: everything
 * is scoped by company_id except the Party master). Defaults to BFM.
 */
export async function getActiveCompany(): Promise<CompanyInfo> {
  const companies = await getCompanies();
  const cookieId = (await cookies()).get(COOKIE_NAME)?.value;
  const active = companies.find((c) => c.id === cookieId);
  return (
    active ?? companies.find((c) => c.name === "BFM") ?? companies[0]
  );
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
