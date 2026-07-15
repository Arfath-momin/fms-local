"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { setActiveCompanyCookie } from "@/lib/company";
import { destroySession, requireSession } from "@/lib/session";

export async function switchCompany(formData: FormData) {
  await requireSession();
  const companyId = String(formData.get("companyId") ?? "");
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error("Unknown company.");
  await setActiveCompanyCookie(company.id);
  revalidatePath("/", "layout");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
