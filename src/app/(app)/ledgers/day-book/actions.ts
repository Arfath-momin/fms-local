"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { toInputDate } from "@/lib/format";

/**
 * Explicit "Close Day" — the confirmed trigger model (spec §3.9). Once a
 * date is closed, every write path rejects it and corrections go through
 * the error-flag flow. There is deliberately no way to reopen a day.
 */
export async function closeDay(formData: FormData) {
  await requireMerchant();
  const company = await getActiveCompany();

  const raw = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Pick a date.");
  const date = new Date(raw);
  const today = new Date(toInputDate(new Date()));
  if (date.getTime() > today.getTime())
    throw new Error("Cannot close a future day.");

  try {
    await prisma.dayClose.create({
      data: { companyId: company.id, date },
    });
  } catch (e) {
    // Already closed — treat as done.
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    ) {
      throw e;
    }
  }

  revalidatePath("/", "layout");
  redirect(`/ledgers/day-book?date=${raw}`);
}
