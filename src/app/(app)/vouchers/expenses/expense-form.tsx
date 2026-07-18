"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { ExpenseFormState } from "./actions";
import type { ExpenseCategory } from "@/generated/prisma/enums";

const CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] = [
  { value: "LOADERS", label: "Loaders" },
  { value: "WORKERS", label: "Workers" },
  { value: "ICE", label: "Ice" },
  { value: "CANTEEN", label: "Canteen" },
  { value: "RENT", label: "Rent" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "FUEL", label: "Fuel" },
  { value: "MISC", label: "Miscellaneous" },
];

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export function ExpenseForm({
  action,
  initial,
  submitLabel,
  reasonField,
}: {
  action: (
    prev: ExpenseFormState,
    formData: FormData
  ) => Promise<ExpenseFormState>;
  initial?: {
    category: ExpenseCategory;
    amount: string;
    date: string;
    notes: string | null;
  };
  submitLabel: string;
  reasonField?: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    ExpenseFormState,
    FormData
  >(action, null);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="category" className={labelCls}>
            Category
          </label>
          <select
            id="category"
            name="category"
            required
            defaultValue={initial?.category ?? ""}
            className={inputCls}
          >
            <option value="" disabled>
              Select…
            </option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="amount" className={labelCls}>
            Amount (₹)
          </label>
          <input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            defaultValue={initial?.amount ?? ""}
            className={inputCls + " num text-right"}
          />
        </div>
        <div>
          <label htmlFor="date" className={labelCls}>
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            defaultValue={initial?.date ?? today}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className={labelCls}>
          Notes (optional)
        </label>
        <input
          id="notes"
          name="notes"
          defaultValue={initial?.notes ?? ""}
          className={inputCls}
        />
      </div>

      {reasonField && (
        <div>
          <label htmlFor="reason" className={labelCls}>
            Reason for correction (optional)
          </label>
          <input id="reason" name="reason" className={inputCls} />
        </div>
      )}

      {state?.error && <p className="text-debit text-[13px]">{state.error}</p>}

      <div className="flex gap-3 items-center">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white px-5 py-2 text-[13px] font-semibold disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link
          href="/vouchers/expenses"
          className="text-muted text-[13px] underline underline-offset-2"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
