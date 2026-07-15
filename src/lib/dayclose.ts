import "server-only";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Once a date has a DayClose record, no direct edits to that day's entries
 * are permitted through the normal UI (spec §2 DayClose). Post-close
 * corrections go through the ErrorFlag flow (Phase 7).
 */
export async function assertDayOpen(
  tx: Prisma.TransactionClient,
  companyId: string,
  date: Date
) {
  const closed = await tx.dayClose.findUnique({
    where: { companyId_date: { companyId, date } },
  });
  if (closed) {
    throw new Error(
      "This day has been closed. Corrections to closed days go through the error-flag flow."
    );
  }
}
