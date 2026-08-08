import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getActiveCompany, type CompanyInfo } from "@/lib/company";
import {
  SCOPE_CENTRE_FIELD,
  SCOPE_COMPANY_FIELD,
  type FormScope,
} from "@/lib/scope";

const COOKIE_NAME = "fms_centre";

export type CentreInfo = { id: string; name: string; companyId: string };

/**
 * All centres of a company, alphabetical. Memoised per request for the same
 * reason as getCompanies(): getActiveCentre() calls it and so does the layout.
 * cache() keys on companyId, so switching company still reads fresh.
 */
export const getCentres = cache(async function getCentres(
  companyId: string
): Promise<CentreInfo[]> {
  return prisma.centre.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, companyId: true },
  });
});

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

// ---------------------------------------------------------------------------
// Scope pinning for entry forms
//
// The scope lives in a cookie, so it is whatever it is at the moment a form is
// submitted — not what it was when the form was drawn. Without a check, filling
// in a payment against a party's outstanding balance in one centre, switching
// centre, and hitting Save writes the voucher into the centre the user is no
// longer looking at, against a balance that was never on screen.
//
// Every entry form therefore carries the scope it was rendered under in hidden
// fields, and every create action compares them. Switching also navigates away
// (see the app's switchCompany/switchCentre), which handles the common case;
// this handles the rest — a second tab, a back button, a restored session.
// ---------------------------------------------------------------------------

/** The values an entry form must echo back. */
export const scopeFieldValues = (scope: ActiveScope): FormScope => ({
  companyId: scope.company.id,
  centreId: scope.centre.id,
});

/**
 * The active scope, but only if it is the one the submitted form was rendered
 * under. Returns a message aimed at the person who has just lost their typing,
 * naming where they are now so the mismatch is not a mystery.
 */
export async function requireSubmittedScope(
  formData: FormData
): Promise<{ scope: ActiveScope } | { error: string }> {
  const scope = await requireActiveScope();
  const companyId = String(formData.get(SCOPE_COMPANY_FIELD) ?? "");
  const centreId = String(formData.get(SCOPE_CENTRE_FIELD) ?? "");

  if (companyId !== scope.company.id || centreId !== scope.centre.id) {
    return {
      error:
        `Nothing was saved. This form was opened under a different company or centre, ` +
        `and you are now in ${scope.company.name} · ${scope.centre.name}. ` +
        `Open the form again and re-enter it, so the voucher lands where you can see it.`,
    };
  }
  return { scope };
}
