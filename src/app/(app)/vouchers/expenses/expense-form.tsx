"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { ExpenseFormState } from "./actions";
import type { ExpenseCategory } from "@/generated/prisma/enums";
import { EXPENSE_CATEGORIES, EXPENSE_SPECS, expensePrepaid } from "@/lib/expense";
import { businessToday, fmtMoney } from "@/lib/format";
import type { FormScope } from "@/lib/scope";
import { BillUpload } from "../bill-upload";
import { ScopeFields } from "../scope-fields";
import { DateField } from "../../date-field";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export type ExpenseInit = {
  category: ExpenseCategory;
  amount: string;
  date: string;
  notes: string | null;
  details: Record<string, string>;
};

export function ExpenseForm({
  action,
  initial,
  submitLabel,
  reasonField,
  existingAttachments = 0,
  allowBillUpload = true,
  scope,
}: {
  action: (
    prev: ExpenseFormState,
    formData: FormData
  ) => Promise<ExpenseFormState>;
  initial?: ExpenseInit;
  submitLabel: string;
  reasonField?: boolean;
  existingAttachments?: number;
  /** False once the voucher exists — the Attachments panel handles images then. */
  allowBillUpload?: boolean;
  scope: FormScope;
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

  // What has already been handed over against this total, and what is left.
  const prepaid = expensePrepaid(category, details);
  const balance = (computedTotal ?? 0) - prepaid;

  const setField = (name: string, value: string) =>
    setDetails((d) => ({ ...d, [name]: value }));

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <ScopeFields scope={scope} />
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
          <DateField
            id="date"
            name="date"
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
        <div className="border border-line-strong bg-surface px-3 py-2 max-w-xs">
          <div className="flex items-center justify-between">
            <span className={labelCls + " mb-0"}>Total</span>
            <span className="num text-debit font-semibold">
              {fmtMoney(computedTotal ?? 0)}
            </span>
          </div>

          {/* Vehicle rent is agreed as one figure and paid in pieces. Showing
              what is left as it is typed is the number the merchant actually
              acts on — it becomes the vendor's outstanding balance on save,
              settled later from Payments. */}
          {spec.prepaidFrom && prepaid > 0 && (
            <>
              <div className="flex items-center justify-between border-t border-line mt-1 pt-1 text-[13px]">
                <span className="text-muted">Already paid</span>
                <span className="num text-credit">{fmtMoney(prepaid)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-line mt-1 pt-1 text-[13px]">
                <span className="font-semibold">Balance to pay</span>
                <span
                  className={`num font-semibold ${
                    balance < 0 ? "text-debit" : ""
                  }`}
                >
                  {fmtMoney(balance)}
                </span>
              </div>
              {balance < 0 && (
                <p className="text-debit text-[12px] mt-1">
                  Already paid is more than the total — check the figures.
                </p>
              )}
            </>
          )}
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

      {allowBillUpload && (
        <BillUpload
          label="Bill / Receipt"
          hint="Optional."
          existingCount={existingAttachments}
        />
      )}

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
