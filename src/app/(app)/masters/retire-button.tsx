"use client";

import { useActionState, useState } from "react";

/** Both party and centre actions report failure the same way. */
export type RetireState = { error: string } | null;
export type RetireAction = (
  prev: RetireState,
  formData: FormData
) => Promise<RetireState>;

/**
 * A master-list action that needs a second thought before it runs.
 *
 * The confirmation is an inline two-step rather than window.confirm() so the
 * warning can say what will actually happen — "hidden everywhere except the
 * records it already appears on" is the whole point of archiving, and a native
 * dialog has nowhere to put it. It also keeps the interaction inside the table
 * row, next to the name being acted on.
 */
export function RetireButton({
  action,
  label,
  pendingLabel,
  warning,
  tone = "muted",
}: {
  action: RetireAction;
  label: string;
  pendingLabel: string;
  /** Shown only once armed — what this does, in the merchant's terms. */
  warning: string;
  tone?: "muted" | "danger";
}) {
  const [state, formAction, pending] = useActionState<RetireState, FormData>(
    action,
    null
  );
  const [armed, setArmed] = useState(false);

  const toneClass = tone === "danger" ? "text-debit" : "text-accent";

  if (!armed) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setArmed(true)}
          className={`${toneClass} underline underline-offset-2 text-[12px]`}
        >
          {label}
        </button>
        {state && "error" in state && (
          <p className="text-debit text-[12px] mt-1 normal-case">
            {state.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction}>
      <p className="text-[12px] text-muted mb-1 normal-case">{warning}</p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className={`${toneClass} font-semibold underline underline-offset-2 text-[12px] disabled:opacity-60`}
        >
          {pending ? pendingLabel : `Yes, ${label.toLowerCase()}`}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="text-muted underline underline-offset-2 text-[12px]"
        >
          Cancel
        </button>
      </div>
      {state && "error" in state && (
        <p className="text-debit text-[12px] mt-1 normal-case">{state.error}</p>
      )}
    </form>
  );
}
