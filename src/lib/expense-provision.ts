import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/expense";

/**
 * Give a company the standard expense heads, if it does not have them already.
 *
 * Called wherever a company comes into existence — the Companies screen and
 * scripts/bootstrap.ts — so no route can produce a company that cannot record
 * an expense. RENT in particular is load-bearing: recordTripRent and the
 * market-bill rent path both look it up by code and throw without it, so a
 * company missing it can raise a delivery note and then be unable to close it.
 *
 * Idempotent by (companyId, code), which is the table's own unique key. That
 * matters in three places at once: re-running bootstrap, backfilling a company
 * that already has some of the list, and the migration that seeds every
 * existing company. Running it twice adds nothing the second time.
 *
 * Deliberately does NOT revive an archived head. Archiving is the merchant
 * saying "we do not use this one" — quietly putting it back on the next
 * provision would override that decision every time, and the row still exists,
 * so `skipDuplicates` leaves it alone.
 *
 * sortOrder follows the order of the list, so the pickers read DIRECT heads
 * first and OTHER last rather than alphabetically.
 */
export async function ensureDefaultExpenseCategories(
  tx: Prisma.TransactionClient,
  companyId: string
): Promise<number> {
  const result = await tx.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((c, i) => ({
      companyId,
      code: c.code,
      name: c.name,
      kind: c.kind,
      allowsLines: c.allowsLines,
      sortOrder: i,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
