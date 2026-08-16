"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  getActiveCompany,
  getCompanies,
  setActiveCompanyCookie,
} from "@/lib/company";
import { setActiveCentreCookie } from "@/lib/centre";
import { destroySession, landingPathFor, requireSession } from "@/lib/session";

/**
 * Both switchers land the user back on their home screen rather than leaving
 * them where they were.
 *
 * Switching only revalidates the layout, so a half-filled entry form stays on
 * screen with the previous centre's figures in it — and every create action
 * reads the scope at submit time, which is the *new* one. Navigating away
 * closes that window: an entry screen is always re-entered under the scope it
 * will actually be saved into. The create actions still verify the scope they
 * were rendered with (see requireSubmittedScope), because a second tab can
 * hold a stale form that no redirect here can reach.
 */
export async function switchCompany(formData: FormData) {
  const session = await requireSession();
  const companyId = String(formData.get("companyId") ?? "");

  // Checked against what this user actually holds, not against the company
  // table. getActiveCompany() would refuse an ungranted cookie anyway, but a
  // switch that appeared to succeed and then silently put them somewhere else
  // is a worse answer than saying no here.
  const allowed = await getCompanies();
  if (!allowed.some((c) => c.id === companyId))
    throw new Error("You do not have access to that company.");

  await setActiveCompanyCookie(companyId);
  revalidatePath("/", "layout");
  redirect(landingPathFor(session.role));
}

export async function switchCentre(formData: FormData) {
  const session = await requireSession();
  const centreId = String(formData.get("centreId") ?? "");
  // Scoped to the active company: a centre id from another company must not be
  // settable, or the cookie would point outside the company boundary above.
  const company = await getActiveCompany();
  const centre = await prisma.centre.findFirst({
    where: { id: centreId, companyId: company.id, archivedAt: null },
  });
  if (!centre) throw new Error("Unknown centre.");
  await setActiveCentreCookie(centre.id);
  revalidatePath("/", "layout");
  redirect(landingPathFor(session.role));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
