"use client";

import { useActionState, useState } from "react";
import { deleteCompany, type CompanyFormState } from "./actions";

/**
 * Delete a company, offered only when it owns nothing.
 *
 * A company with a single centre or voucher can never be removed — everything
 * in the books hangs off it — so the button is not shown at all rather than
 * shown and then refused. The server re-checks regardless, since this page can
 * be minutes stale.
 */
export function DeleteCompany({
  companyId,
  name,
  references,
  isOnly,
}: {
  companyId: string;
  name: string;
  references: number;
  isOnly: boolean;
}) {
  const [state, action, pending] = useActionState<CompanyFormState, FormData>(
    deleteCompany.bind(null, companyId),
    null
  );
  const [armed, setArmed] = useState(false);

  if (references > 0)
    return (
      <span className="text-muted text-[12px] whitespace-nowrap">In use</span>
    );
  // Removing the last company would leave nobody able to use the app, and no
  // screen from which to create another.
  if (isOnly)
    return (
      <span className="text-muted text-[12px] whitespace-nowrap">
        Only company
      </span>
    );

  if (!armed)
    return (
      <div className="text-right">
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="text-debit underline underline-offset-2 text-[12px]"
        >
          Delete
        </button>
        {state && "error" in state && (
          <p className="text-debit text-[12px] mt-1">{state.error}</p>
        )}
      </div>
    );

  return (
    <form action={action} className="text-right">
      <p className="text-[12px] text-muted mb-1">
        {name} holds no centres or vouchers. This cannot be undone.
      </p>
      <div className="flex gap-2 justify-end">
        <button
          type="submit"
          disabled={pending}
          className="text-debit font-semibold underline underline-offset-2 text-[12px] disabled:opacity-60"
        >
          {pending ? "Deleting…" : "Yes, delete"}
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
        <p className="text-debit text-[12px] mt-1">{state.error}</p>
      )}
    </form>
  );
}
