import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ReviewLinkedType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

// The database half of review requests. The labels and routes they are rendered
// with live in review.ts, which the client-side request form imports.

export type OpenReview = {
  id: string;
  reason: string;
  requestedAt: Date;
  requestedBy: { name: string } | null;
};

/**
 * The open request against one voucher, if there is one. Detail pages call this
 * to decide between showing the banner and offering the request form.
 */
export async function getOpenReview(
  linkedType: ReviewLinkedType,
  linkedId: string
): Promise<OpenReview | null> {
  return prisma.reviewRequest.findFirst({
    where: { linkedType, linkedId, status: "OPEN" },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      reason: true,
      requestedAt: true,
      requestedBy: { select: { name: true } },
    },
  });
}

export type PendingReview = OpenReview & {
  linkedType: ReviewLinkedType;
  linkedId: string;
};

/** Every open request in one company and centre, oldest first — the ones that
 * have been waiting longest are the ones that need answering. */
export async function getPendingReviews(
  companyId: string,
  centreId: string
): Promise<PendingReview[]> {
  return prisma.reviewRequest.findMany({
    where: { companyId, centreId, status: "OPEN" },
    orderBy: { requestedAt: "asc" },
    select: {
      id: true,
      linkedType: true,
      linkedId: true,
      reason: true,
      requestedAt: true,
      requestedBy: { select: { name: true } },
    },
  });
}

/**
 * Close every open request against a voucher, because an admin has just changed
 * or removed it.
 *
 * Requests are never deleted, not even when the voucher is: the request is the
 * record that a correction was asked for and by whom, and that has to outlive
 * the row it was about. Call this from the update and delete action of every
 * voucher type, inside the same transaction, so a failed save leaves the
 * request standing.
 */
export async function resolveReviews(
  tx: Prisma.TransactionClient,
  linkedType: ReviewLinkedType,
  linkedId: string,
  resolvedById: string
): Promise<void> {
  await tx.reviewRequest.updateMany({
    where: { linkedType, linkedId, status: "OPEN" },
    data: { status: "RESOLVED", resolvedById, resolvedAt: new Date() },
  });
}

/**
 * The company and centre a voucher belongs to, whatever kind it is.
 *
 * The request is filed against these, not against the scope the requester is
 * sitting in — those agree today, because a voucher only opens inside its own
 * scope, but the row is what the admin has to be able to find, so it is what
 * decides where the request lands. Returns null when the id names nothing,
 * which is also how a settlement id arriving on the wrong route is rejected.
 */
export async function getVoucherScope(
  tx: Prisma.TransactionClient,
  linkedType: ReviewLinkedType,
  linkedId: string
): Promise<{ companyId: string; centreId: string } | null> {
  const where = { id: linkedId };
  const select = { companyId: true, centreId: true };

  switch (linkedType) {
    case "PURCHASE":
      return tx.purchase.findUnique({ where, select });
    case "SALE":
      return tx.sale.findUnique({ where, select });
    case "EXPENSE":
      return tx.expense.findUnique({ where, select });
    case "DELIVERY_NOTE":
      return tx.deliveryNote.findUnique({ where, select });
    case "PAYMENT":
    case "RECEIPT": {
      // Payments and receipts share one table, so the kind is checked rather
      // than trusted — the same care deleteSettlement takes.
      const settlement = await tx.settlement.findUnique({
        where,
        select: { ...select, kind: true },
      });
      if (!settlement || settlement.kind !== linkedType) return null;
      return { companyId: settlement.companyId, centreId: settlement.centreId };
    }
  }
}
