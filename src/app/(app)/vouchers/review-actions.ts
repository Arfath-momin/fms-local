"use server";

import { revalidatePath } from "next/cache";
import type { ReviewLinkedType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireReviewRequester } from "@/lib/session";
import { REVIEW_REASON_MAX, reviewVoucherPath } from "@/lib/review";
import { getVoucherScope } from "@/lib/review-db";

export type ReviewFormState = { error: string } | null;

/**
 * Raise a request for an admin to correct a voucher.
 *
 * Nothing about the voucher changes here — no ledger, no amount, no status on
 * the row itself. The request is a message with a pointer, and the correction
 * is still an ordinary admin edit made later.
 *
 * `linkedType` and `linkedId` are bound at render time, but the action is a
 * public endpoint all the same, so both the role and the voucher are checked
 * again here. The scope is read off the voucher rather than off the requester's
 * cookies: the request has to land where the entry lives.
 */
export async function requestReview(
  linkedType: ReviewLinkedType,
  linkedId: string,
  _prev: ReviewFormState,
  formData: FormData
): Promise<ReviewFormState> {
  const session = await requireReviewRequester();

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason)
    return {
      error: "Say what needs changing — the admin only sees what you write here.",
    };
  if (reason.length > REVIEW_REASON_MAX)
    return {
      error: `Keep it under ${REVIEW_REASON_MAX} characters — the detail belongs on the voucher, not in the request.`,
    };

  try {
    await prisma.$transaction(async (tx) => {
      const scope = await getVoucherScope(tx, linkedType, linkedId);
      if (!scope) throw new Error("That voucher no longer exists.");

      // One open request per voucher. A second one would give the admin two
      // rows describing the same fix, and closing the voucher's requests on
      // edit would close both anyway.
      const open = await tx.reviewRequest.findFirst({
        where: { linkedType, linkedId, status: "OPEN" },
        select: { id: true },
      });
      if (open)
        throw new Error(
          "A review has already been requested for this voucher and is still open."
        );

      await tx.reviewRequest.create({
        data: {
          companyId: scope.companyId,
          centreId: scope.centreId,
          linkedType,
          linkedId,
          reason,
          requestedById: session.userId,
        },
      });
    });
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not send the review request.",
    };
  }

  revalidatePath(reviewVoucherPath(linkedType, linkedId));
  // Where the admin reads it.
  revalidatePath("/dashboard");
  return null;
}
