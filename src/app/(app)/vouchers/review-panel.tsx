import type { ReviewLinkedType } from "@/generated/prisma/enums";
import { getOpenReview } from "@/lib/review-db";
import { canEdit, canRequestReview, requireSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import { RequestReview } from "./request-review";
import { requestReview } from "./review-actions";

/**
 * The review strip every voucher detail page ends with.
 *
 * One of three things, in this order:
 *   · a request is open — everyone sees the banner, including the accountant
 *     who raised it, so nobody sends the same correction twice;
 *   · nothing is open and you are the accountant — the request control;
 *   · nothing is open and you are anyone else — nothing at all. An admin edits
 *     rather than asks, and an auditor neither.
 *
 * The banner is what tells the admin *why* they were called in, so it stays on
 * screen above their edit form until the edit itself closes the request.
 */
export async function ReviewPanel({
  linkedType,
  linkedId,
  noun,
}: {
  linkedType: ReviewLinkedType;
  linkedId: string;
  /** What the voucher is called, lower case: "purchase", "delivery note", … */
  noun: string;
}) {
  const session = await requireSession();
  const open = await getOpenReview(linkedType, linkedId);

  if (open) {
    return (
      <div className="mt-6 max-w-lg border border-amber-500 bg-surface px-4 py-3">
        <p className="text-[13px] font-semibold">
          Review requested
          {open.requestedBy && <> by {open.requestedBy.name}</>} ·{" "}
          <span className="text-muted font-normal">
            {fmtDateTime(open.requestedAt)}
          </span>
        </p>
        <p className="text-[13px] mt-1">{open.reason}</p>
        {/* Keyed on who can actually act. An auditor reads the same banner as
            the accountant: neither of them is the one who fixes it. */}
        <p className="text-muted text-[12px] mt-2">
          {canEdit(session.role)
            ? `Editing this ${noun} closes the request.`
            : `Waiting on an admin. The ${noun} is unchanged until they edit it.`}
        </p>
      </div>
    );
  }

  if (!canRequestReview(session.role)) return null;

  return (
    <RequestReview
      action={requestReview.bind(null, linkedType, linkedId)}
      noun={noun}
    />
  );
}
