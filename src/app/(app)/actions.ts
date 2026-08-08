"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { setActiveCompanyCookie } from "@/lib/company";
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
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error("Unknown company.");
  await setActiveCompanyCookie(company.id);
  revalidatePath("/", "layout");
  redirect(landingPathFor(session.role));
}

export async function switchCentre(formData: FormData) {
  const session = await requireSession();
  const centreId = String(formData.get("centreId") ?? "");
  const centre = await prisma.centre.findUnique({ where: { id: centreId } });
  if (!centre) throw new Error("Unknown centre.");
  await setActiveCentreCookie(centre.id);
  revalidatePath("/", "layout");
  redirect(landingPathFor(session.role));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
