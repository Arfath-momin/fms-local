"use client";

import { useActionState, useEffect, useRef } from "react";
import { RetireButton } from "../retire-button";
import {
  archiveExpenseCategory,
  createExpenseCategory,
  deleteExpenseCategory,
  unarchiveExpenseCategory,
  type CategoryFormState,
} from "./actions";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export function CategoryCreateForm() {
  const [state, formAction, pending] = useActionState<
    CategoryFormState,
    FormData
  >(createExpenseCategory, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && !state) ref.current?.reset();
  }, [pending, state]);

  return (
    <form action={formAction} ref={ref} className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="name" className={labelCls}>
            Name
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="e.g. Electricity"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="kind" className={labelCls}>
            Tier
          </label>
          <select id="kind" name="kind" required defaultValue="DIRECT" className={inputCls}>
            <option value="DIRECT">Direct — cost of the catch</option>
            <option value="OVERHEAD">Overhead — cost of the month</option>
          </select>
          {/* The one thing worth getting right, so it is stated rather than
              left to be inferred from the label. */}
          <p className="text-muted text-[12px] mt-1">
            Direct costs set a buying day&rsquo;s gross profit. Overheads touch
            the monthly net figure only.
          </p>
        </div>
        <div>
          <label htmlFor="code" className={labelCls}>
            Code (optional)
          </label>
          <input
            id="code"
            name="code"
            placeholder="from the name"
            className={inputCls + " num"}
          />
          <p className="text-muted text-[12px] mt-1">
            Used in links. Made from the name when left blank.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="allowsLines" />
        Enter this one as a list of items rather than a single total
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white px-5 py-2 text-[13px] font-semibold disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add category"}
        </button>
        {state?.error && (
          <p className="text-debit text-[13px]">{state.error}</p>
        )}
      </div>
    </form>
  );
}

/** Retire controls for one category row — same shape as centres and vehicles. */
export function CategoryActionsCell({
  categoryId,
  name,
  code,
  archived,
  expenses,
  isSuperAdmin,
}: {
  categoryId: string;
  name: string;
  code: string;
  archived: boolean;
  expenses: number;
  isSuperAdmin: boolean;
}) {
  const unused = expenses === 0;

  // Every trip files its rent here, so retiring it would break trip entry with
  // an error the merchant could not act on.
  if (code === "RENT") {
    return (
      <span className="text-muted text-[12px] normal-case">Required</span>
    );
  }

  if (archived) {
    return (
      <div className="flex flex-col gap-1">
        {isSuperAdmin ? (
          <>
            <RetireButton
              action={unarchiveExpenseCategory.bind(null, categoryId)}
              label="Restore"
              pendingLabel="Restoring…"
              warning={`${name} goes back into the expense form.`}
            />
            {unused && (
              <RetireButton
                action={deleteExpenseCategory.bind(null, categoryId)}
                label="Delete for good"
                pendingLabel="Deleting…"
                tone="danger"
                warning={`Nothing has ever been filed under ${name}, so it can be removed completely. This cannot be undone.`}
              />
            )}
          </>
        ) : (
          <span className="text-muted text-[12px]">Archived</span>
        )}
      </div>
    );
  }

  if (unused && isSuperAdmin) {
    return (
      <RetireButton
        action={deleteExpenseCategory.bind(null, categoryId)}
        label="Delete"
        pendingLabel="Deleting…"
        tone="danger"
        warning={`Nothing has ever been filed under ${name}, so it will be removed completely. This cannot be undone.`}
      />
    );
  }

  return (
    <RetireButton
      action={archiveExpenseCategory.bind(null, categoryId)}
      label="Delete"
      pendingLabel="Removing…"
      warning={
        unused
          ? `${name} will stop being offered on the expense form.`
          : `${name} will stop being offered on the expense form. Its ${expenses} existing expense${expenses === 1 ? "" : "s"} and every report reading them are unchanged.`
      }
    />
  );
}
