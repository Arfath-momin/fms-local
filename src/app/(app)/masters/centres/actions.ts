"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { setActiveCentreCookie } from "@/lib/centre";

export type CentreFormState = { error: string } | null;

/**
 * Add a centre to the active company. The new centre is made active
 * immediately so the merchant can start entering into it.
 */
export async function createCentre(
  _prev: CentreFormState,
  formData: FormData
): Promise<CentreFormState> {
  await requireMerchant();
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
  await requireMerchant();
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
