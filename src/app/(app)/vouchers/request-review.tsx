"use client";

import { useActionState, useState } from "react";
import { REVIEW_REASON_MAX } from "@/lib/review";
import type { ReviewFormState } from "./review-actions";

/**
 * The accountant's "something is wrong with this entry" control.
 *
 * Collapsed to a single button until it is wanted, like DeleteVoucher, because
 * it sits at the foot of every voucher and is the exception rather than the
 * routine. Opening it asks for the reason immediately — a request with no
 * reason gives the admin a voucher to stare at and nothing to change.
 */
export function RequestReview({
  action,
  noun,
}: {
  action: (prev: ReviewFormState, formData: FormData) => Promise<ReviewFormState>;
  /** What the request is about, lower case: "purchase", "receipt", … */
  noun: string;
}) {
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(
    action,
    null
  );
  const [open, setOpen] = useState(false);

  const error = state?.error && (
    <p className="text-debit text-[13px] mt-2">{state.error}</p>
  );

  if (!open) {
    return (
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold hover:border-accent"
        >
          Request admin review
        </button>
        <p className="text-muted text-[12px] mt-1 max-w-lg">
          Found a mistake? You cannot change a saved {noun} yourself — send it to
          the admin with a note and they will correct it.
        </p>
        {error}
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-6 max-w-lg border border-line-strong bg-surface px-4 py-3"
    >
      <p className="text-[13px] font-semibold">Request a review of this {noun}</p>
      <p className="text-muted text-[12px] mt-1">
        It goes to the admin under the company and centre this {noun} was entered
        in. The {noun} stays as it is until they change it.
      </p>
      <label
        htmlFor="reason"
        className="block text-[11px] uppercase tracking-wide text-muted font-semibold mt-3 mb-1"
      >
        What needs changing?
      </label>
      <textarea
        id="reason"
        name="reason"
        rows={3}
        required
        maxLength={REVIEW_REASON_MAX}
        autoFocus
        placeholder="e.g. Amount should be 45,200 — the bill total was typed short by 2,700."
        className="w-full border border-line-strong bg-background px-2 py-1.5 text-[13px]"
      />
      <div className="flex items-center gap-2 mt-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send to admin"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold hover:border-accent disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
      {error}
    </form>
  );
}
