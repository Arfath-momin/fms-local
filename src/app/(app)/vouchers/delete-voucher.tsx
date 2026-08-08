"use client";

import { useActionState, useState } from "react";

export type DeleteState = { error: string } | null;

/**
 * Two-step delete, shared by every voucher detail page.
 *
 * The first click only arms the control; the destructive submit is a second,
 * deliberate one. It is an inline panel rather than window.confirm so the
 * warning can say what actually happens — removing a voucher rewrites the
 * running balance on every ledger it touched, which nobody would infer from
 * the word "Delete" alone.
 */
export function DeleteVoucher({
  action,
  noun,
  warning = "Its ledger entries go with it and every affected party's running balance is rebuilt without it.",
}: {
  action: (prev: DeleteState) => Promise<DeleteState>;
  /** What is being deleted, lower case: "purchase", "receipt", … */
  noun: string;
  warning?: string;
}) {
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(
    action,
    null
  );
  const [armed, setArmed] = useState(false);

  const error = state?.error && (
    <p className="text-debit text-[13px] mt-2">{state.error}</p>
  );

  if (!armed) {
    return (
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold text-debit hover:border-debit"
        >
          Delete {noun}
        </button>
        {error}
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-6 max-w-lg border border-debit bg-surface px-4 py-3"
    >
      <p className="text-debit text-[13px] font-semibold">
        Delete this {noun}?
      </p>
      <p className="text-muted text-[12px] mt-1">{warning} This cannot be undone.</p>
      <div className="flex items-center gap-2 mt-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-debit text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60"
        >
          {pending ? "Deleting…" : `Yes, delete ${noun}`}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
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
