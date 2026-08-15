"use client";

import { useActionState } from "react";
import { closeLot, reopenLot, type LotFormState } from "./actions";

/**
 * Close / Reopen for one lot row.
 *
 * Closing needs no confirmation — it is reversible by an admin and states an
 * everyday fact ("that fish is gone"). Reopening is the one an admin is
 * trusted with, so only they see it.
 */
export function LotActionsCell({
  lotId,
  code,
  closed,
  isOverhead,
  mayReopen,
}: {
  lotId: string;
  code: string;
  closed: boolean;
  isOverhead: boolean;
  mayReopen: boolean;
}) {
  const action = closed ? reopenLot : closeLot;
  const [state, formAction, pending] = useActionState<LotFormState, FormData>(
    action.bind(null, lotId),
    null
  );

  // The General lot has no last sale to end it, so it is never closed.
  if (isOverhead) return <span className="text-muted text-[12px]">—</span>;
  if (closed && !mayReopen)
    return <span className="text-muted text-[12px]">Closed</span>;

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="text-accent underline underline-offset-2 text-[12px] disabled:opacity-60"
        title={
          closed
            ? `Put ${code} back into the sale and expense dropdowns`
            : `Stop new entries landing on ${code}`
        }
      >
        {pending ? "Saving…" : closed ? "Reopen" : "Close"}
      </button>
      {state && "error" in state && (
        <p className="text-debit text-[12px] mt-1 normal-case">{state.error}</p>
      )}
    </form>
  );
}
