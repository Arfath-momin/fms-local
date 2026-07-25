import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { toInputDate } from "@/lib/format";

/**
 * Once a date has a DayClose record, no direct edits to that day's entries
 * are permitted through the normal UI (spec §2 DayClose). Post-close
 * corrections go through the ErrorFlag flow (Phase 7).
 */
export async function assertDayOpen(
  tx: Prisma.TransactionClient,
  companyId: string,
  centreId: string,
  date: Date
) {
  const closed = await tx.dayClose.findUnique({
    where: { companyId_centreId_date: { companyId, centreId, date } },
  });
  if (closed) {
    throw new Error(
      "This day has been closed. Corrections to closed days go through the error-flag flow."
    );
  }
}

/**
 * All closed dates for a (company, centre), as "YYYY-MM-DD" strings for list
 * markers. Day close is per centre — each centre's days close independently.
 */
export async function getClosedDateSet(
  companyId: string,
  centreId: string
): Promise<Set<string>> {
  const rows = await prisma.dayClose.findMany({
    where: { companyId, centreId },
    select: { date: true },
  });
  return new Set(rows.map((r) => toInputDate(r.date)));
}

export async function isDayClosed(
  companyId: string,
  centreId: string,
  date: Date
) {
  return Boolean(
    await prisma.dayClose.findUnique({
      where: { companyId_centreId_date: { companyId, centreId, date } },
    })
  );
}
