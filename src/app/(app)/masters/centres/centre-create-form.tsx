"use client";

import { useActionState, useRef, useEffect } from "react";
import { createCentre, type CentreFormState } from "./actions";

export function CentreCreateForm() {
  const [state, formAction, pending] = useActionState<CentreFormState, FormData>(
    createCentre,
    null
  );
  const ref = useRef<HTMLFormElement>(null);

  // Clear the field after a successful add (the action redirects, but on the
  // no-redirect error path we keep whatever the user typed).
  useEffect(() => {
    if (!pending && !state) ref.current?.reset();
  }, [pending, state]);

  return (
    <form action={formAction} ref={ref} className="flex items-end gap-2">
      <div className="flex-1">
        <label
          htmlFor="name"
          className="block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1"
        >
          New centre name
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="e.g. Centre 1 — Bunder"
          className="w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-white px-5 py-2 text-[13px] font-semibold disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add centre"}
      </button>
      {state?.error && (
        <p className="text-debit text-[13px] basis-full">{state.error}</p>
      )}
    </form>
  );
}
