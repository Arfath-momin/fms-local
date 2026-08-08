import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ErrorFlagLinkedType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

export type FlagInfo = {
  reason: string | null;
  correctingEntryId: string | null;
  flaggedAt: Date;
};

/**
 * Closed-day corrections (spec §2 ErrorFlag): the original voucher record is
 * never deleted — it gets a flag and stays visible (struck-through in lists),
 * its stock/ledger effect rows are replaced by the correction's, and every
 * report aggregate over voucher tables excludes flagged ids via
 * getFlaggedIds().
 */
export async function getFlagsFor(
  linkedType: ErrorFlagLinkedType,
  ids: string[]
): Promise<Map<string, FlagInfo>> {
  if (ids.length === 0) return new Map();
  const flags = await prisma.errorFlag.findMany({
    where: { linkedType, linkedId: { in: ids } },
  });
  return new Map(
    flags.map((f) => [
      f.linkedId,
      {
        reason: f.reason,
        correctingEntryId: f.correctingEntryId,
        flaggedAt: f.flaggedAt,
      },
    ])
  );
}

/**
 * Drop the flag on a voucher that is being deleted.
 *
 * Nothing creates flags any more, but historic ones are still read, and
 * (linked_type, linked_id) is unique — a flag left behind would describe a
 * record that no longer exists and keep excluding a now-absent id from report
 * totals. Deleting the voucher deletes its flag with it.
 */
export async function clearErrorFlag(
  tx: Prisma.TransactionClient,
  linkedType: ErrorFlagLinkedType,
  linkedId: string
): Promise<void> {
  await tx.errorFlag.deleteMany({ where: { linkedType, linkedId } });
}

/** All flagged ids of a type — for excluding from report totals. */
export async function getFlaggedIds(
  linkedType: ErrorFlagLinkedType
): Promise<string[]> {
  const flags = await prisma.errorFlag.findMany({
    where: { linkedType },
    select: { linkedId: true },
  });
  return flags.map((f) => f.linkedId);
}
