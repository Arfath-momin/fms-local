"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, requireSuperAdmin } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getActiveCentre, setActiveCentreCookie } from "@/lib/centre";

export type CentreFormState = { error: string } | null;

/** Everything a centre owns. Deleting is only safe at zero. */
const CENTRE_REFERENCES = {
  purchases: true,
  sales: true,
  deliveryNotes: true,
  expenses: true,
  ledgerEntries: true,
  settlements: true,
  attachments: true,
  reviewRequests: true,
} as const;

/**
 * Add a centre to the active company. The new centre is made active
 * immediately so the merchant can start entering into it.
 */
export async function createCentre(
  _prev: CentreFormState,
  formData: FormData
): Promise<CentreFormState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Centre name is required." };

  const company = await getActiveCompany();
  let centreId: string;
  try {
    const centre = await prisma.centre.create({
      data: { companyId: company.id, name },
    });
    centreId = centre.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { error: `${company.name} already has a centre named “${name}”.` };
    return { error: e instanceof Error ? e.message : "Could not add centre." };
  }

  await setActiveCentreCookie(centreId);
  revalidatePath("/", "layout");
  redirect("/masters/centres");
}

/** Rename a centre (transactions keep their centre_id, so this is safe). */
export async function renameCentre(
  centreId: string,
  _prev: CentreFormState,
  formData: FormData
): Promise<CentreFormState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Centre name is required." };

  const company = await getActiveCompany();
  try {
    await prisma.centre.update({ where: { id: centreId }, data: { name } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { error: `${company.name} already has a centre named “${name}”.` };
    return { error: e instanceof Error ? e.message : "Could not rename centre." };
  }

  revalidatePath("/", "layout");
  redirect("/masters/centres");
}

// ---------------------------------------------------------------------------
// Retiring a centre
//
// Same three operations as a party, with one extra hazard: a centre is the
// scope the whole app works inside. Archiving the one you are standing in, or
// the only one left, would leave the merchant with nowhere to enter anything —
// so the last live centre can never be archived, and archiving the active one
// moves you to another first.
// ---------------------------------------------------------------------------

/** What this centre owns, and whether it is already archived. */
async function centreUsage(centreId: string, companyId: string) {
  const centre = await prisma.centre.findFirst({
    where: { id: centreId, companyId },
    select: {
      name: true,
      archivedAt: true,
      _count: { select: CENTRE_REFERENCES },
    },
  });
  if (!centre) return null;
  const references = Object.values(centre._count).reduce((a, b) => a + b, 0);
  return { name: centre.name, archivedAt: centre.archivedAt, references };
}

/**
 * Retire a centre. Admin and up. Its transactions and ledgers stay exactly as
 * they are and still read in every register and report; it simply stops being
 * offered in the switcher, so nothing new can be entered into it.
 */
export async function archiveCentre(
  centreId: string,
  _prev: CentreFormState,
  _formData: FormData
): Promise<CentreFormState> {
  await requireAdmin();
  const company = await getActiveCompany();

  const usage = await centreUsage(centreId, company.id);
  if (!usage) return { error: "That centre no longer exists." };
  if (usage.archivedAt) return { error: `${usage.name} is already archived.` };

  // Never leave a company with no centre to work in — requireActiveScope()
  // throws when there is none, which takes out every entry screen at once.
  const otherLive = await prisma.centre.count({
    where: { companyId: company.id, archivedAt: null, id: { not: centreId } },
  });
  if (otherLive === 0) {
    return {
      error:
        `${usage.name} is the only active centre in ${company.name}. ` +
        `Add another before archiving this one — there is nowhere to enter into otherwise.`,
    };
  }

  // Read the active centre before archiving, or getActiveCentre() has already
  // fallen through to a different one and the comparison never matches.
  const active = await getActiveCentre(company.id);

  await prisma.centre.update({
    where: { id: centreId },
    data: { archivedAt: new Date() },
  });

  // Standing in the centre that just went away: move to another live one so the
  // next page load has a scope. The cookie would otherwise point at an archived
  // centre and silently fall back, which works but hides what happened.
  if (active?.id === centreId) {
    const next = await prisma.centre.findFirst({
      where: { companyId: company.id, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true },
    });
    if (next) await setActiveCentreCookie(next.id);
  }

  revalidatePath("/", "layout");
  return null;
}

/** Bring an archived centre back into the switcher. Super admin only. */
export async function unarchiveCentre(
  centreId: string,
  _prev: CentreFormState,
  _formData: FormData
): Promise<CentreFormState> {
  await requireSuperAdmin();
  const company = await getActiveCompany();

  const usage = await centreUsage(centreId, company.id);
  if (!usage) return { error: "That centre no longer exists." };

  await prisma.centre.update({
    where: { id: centreId },
    data: { archivedAt: null },
  });

  revalidatePath("/", "layout");
  return null;
}

/**
 * Delete a centre for good. Super admin only, and only when it owns nothing at
 * all — a centre created by mistake, or one that was never entered into. A
 * centre with even one voucher is archived instead: deleting it would take the
 * purchases, sales, expenses and every ledger entry inside it along with it,
 * and the balances they feed would change silently.
 */
export async function deleteCentre(
  centreId: string,
  _prev: CentreFormState,
  _formData: FormData
): Promise<CentreFormState> {
  await requireSuperAdmin();
  const company = await getActiveCompany();

  const usage = await centreUsage(centreId, company.id);
  if (!usage) return { error: "That centre no longer exists." };
  if (usage.references > 0) {
    return {
      error:
        `${usage.name} holds ${usage.references} record${usage.references === 1 ? "" : "s"} ` +
        `and cannot be deleted — archive it instead, which takes it out of the ` +
        `switcher while its ledgers and reports keep reading as they do now.`,
    };
  }

  const active = await getActiveCentre(company.id);
  await prisma.centre.delete({ where: { id: centreId } });

  if (active?.id === centreId) {
    const next = await prisma.centre.findFirst({
      where: { companyId: company.id, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true },
    });
    if (next) await setActiveCentreCookie(next.id);
  }

  revalidatePath("/", "layout");
  return null;
}
