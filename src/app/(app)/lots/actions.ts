"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";

export type LotFormState = { error: string } | null;

/**
 * Declare a consignment sold out.
 *
 * Entry-level, not admin: deciding the fish is gone is the merchant's daily
 * call, and it destroys nothing. A closed lot drops out of the sale and expense
 * dropdowns so nothing new lands on it by accident, but every voucher already
 * on it stays fully editable — closing states a fact, it does not lock a book.
 */
export async function closeLot(
  lotId: string,
  _prev: LotFormState,
  _formData: FormData
): Promise<LotFormState> {
  await requireEntry();
  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  const lot = await prisma.lot.findFirst({
    where: { id: lotId, companyId: company.id, centreId: centre.id },
    select: { id: true, code: true, kind: true, closedAt: true },
  });
  if (!lot) return { error: "That lot is not in this centre." };
  if (lot.kind === "OVERHEAD")
    return {
      error:
        "The General lot is where standing costs go and is never closed — there is no last sale to end it.",
    };
  if (lot.closedAt) return { error: `Lot ${lot.code} is already closed.` };

  await prisma.lot.update({
    where: { id: lotId },
    data: { closedAt: new Date() },
  });
  revalidatePath("/lots");
  return null;
}

/**
 * Reopen a lot that was closed too early.
 *
 * Admin-only, unlike closing. Reopening puts a consignment back into every
 * entry dropdown, which is how a sale ends up on the wrong lot and two lots'
 * profit changes at once — a correction worth one more pair of eyes than the
 * routine act of closing.
 */
export async function reopenLot(
  lotId: string,
  _prev: LotFormState,
  _formData: FormData
): Promise<LotFormState> {
  await requireAdmin();
  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  const lot = await prisma.lot.findFirst({
    where: { id: lotId, companyId: company.id, centreId: centre.id },
    select: { id: true, code: true, closedAt: true },
  });
  if (!lot) return { error: "That lot is not in this centre." };
  if (!lot.closedAt) return { error: `Lot ${lot.code} is already open.` };

  await prisma.lot.update({ where: { id: lotId }, data: { closedAt: null } });
  revalidatePath("/lots");
  return null;
}
