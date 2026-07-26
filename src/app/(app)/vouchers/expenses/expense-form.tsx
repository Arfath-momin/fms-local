"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { ExpenseFormState } from "./actions";
import type { ExpenseCategory } from "@/generated/prisma/enums";
import { EXPENSE_CATEGORIES, EXPENSE_SPECS } from "@/lib/expense";
import { businessToday, fmtMoney } from "@/lib/format";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export type ExpenseInit = {
  category: ExpenseCategory;
  amount: string;
  date: string;
  paid: boolean;
  notes: string | null;
  details: Record<string, string>;
};

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
  initial?: ExpenseInit;
  submitLabel: string;
  reasonField?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ExpenseFormState, FormData>(
    action,
    null
  );
  const [category, setCategory] = useState<ExpenseCategory>(
    initial?.category ?? "ICE"
  );
  const [details, setDetails] = useState<Record<string, string>>(
    initial?.details ?? {}
  );

  const spec = EXPENSE_SPECS[category];
  const today = businessToday();

  const computedTotal = useMemo(() => {
    if (spec.amountEntered) return null;
    if (spec.totalFrom) {
      const [q, r] = spec.totalFrom;
      return (Number(details[q]) || 0) * (Number(details[r]) || 0);
    }
    if (spec.totalField) return Number(details[spec.totalField]) || 0;
    return 0;
  }, [spec, details]);

  const setField = (name: string, value: string) =>
    setDetails((d) => ({ ...d, [name]: value }));

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="category" className={labelCls}>
            Category
          </label>
          <select
            id="category"
            name="category"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className={inputCls}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_SPECS[c].label}
              </option>
            ))}
          </select>
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

      {spec.fields.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {spec.fields.map((f) => (
            <div key={f.name}>
              <label htmlFor={f.name} className={labelCls}>
                {f.label}
                {!f.required && (
                  <span className="normal-case font-normal"> (optional)</span>
                )}
              </label>
              <input
                id={f.name}
                name={f.name}
                required={f.required}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                value={details[f.name] ?? ""}
                onChange={(e) => setField(f.name, e.target.value)}
                className={inputCls + (f.kind === "number" ? " num text-right" : "")}
              />
            </div>
          ))}
        </div>
      )}

      {spec.amountEntered ? (
        <div>
          <label htmlFor="amount" className={labelCls}>
            Total (₹)
          </label>
          <input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            defaultValue={initial?.amount ?? ""}
            className={inputCls + " num text-right max-w-[12rem]"}
          />
        </div>
      ) : (
        <div className="flex items-center justify-between border border-line-strong bg-surface px-3 py-2 max-w-xs">
          <span className={labelCls + " mb-0"}>Total</span>
          <span className="num text-debit font-semibold">
            {fmtMoney(computedTotal ?? 0)}
          </span>
        </div>
      )}

      {spec.note && <p className="text-muted text-[12px]">{spec.note}</p>}

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

      <div>
        <label htmlFor="bill" className={labelCls}>
          Bill / Receipt (optional)
        </label>
        <input
          id="bill"
          name="bill"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="text-[13px]"
        />
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          name="paid"
          defaultChecked={initial ? initial.paid : true}
          className="h-4 w-4"
        />
        Paid (uncheck to leave outstanding in the vendor ledger)
      </label>

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
