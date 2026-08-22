"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { ExpenseFormState } from "./actions";
import {
  EXPENSE_SPECS,
  expensePrepaid,
  type ExpenseFieldSpec,
} from "@/lib/expense";
import { businessToday, fmtMoney } from "@/lib/format";
import type { FormScope } from "@/lib/scope";
import { BillUpload } from "../bill-upload";
import { ScopeFields } from "../scope-fields";
import { DateField } from "../../date-field";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

/// A category as the form needs it. Passed in from the server rather than
/// imported from a constant: the list is data now, so the form cannot know it
/// at build time.
export type ExpenseCategoryOption = {
  id: string;
  code: string;
  name: string;
  allowsLines: boolean;
};

/** One row of an itemised expense. */
export type ExpenseLineInit = { description: string; amount: string };

export type ExpenseInit = {
  categoryId: string;
  lines?: ExpenseLineInit[];
  amount: string;
  /** The purchase day this cost counts against. */
  date: string;
  /** When the money went out. Record only. */
  spentOn: string;
  notes: string | null;
  details: Record<string, string>;
};

export function ExpenseForm({
  action,
  categories,
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
  /** Every live category for this company, in display order. */
  categories: ExpenseCategoryOption[];
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
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId ?? categories[0]?.id ?? ""
  );
  const category = categories.find((c) => c.id === categoryId);
  const [details, setDetails] = useState<Record<string, string>>(
    initial?.details ?? {}
  );
  const [itemLines, setItemLines] = useState<ExpenseLineInit[]>(
    initial?.lines?.length ? initial.lines : [{ description: "", amount: "" }]
  );
  const setItemLine = (i: number, patch: Partial<ExpenseLineInit>) =>
    setItemLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const itemTotal = itemLines.reduce(
    (sum, l) => sum + (Number(l.amount) || 0),
    0
  );

  // A category with no entry spec — anything the merchant added from Masters —
  // falls back to a plain amount field. That fallback is what lets a new
  // category work without a deploy.
  //
  // Memoised because the fallback is a fresh object literal every render, and
  // the total below depends on it: without this the useMemo never hits.
  const spec = useMemo(
    () =>
      (category && EXPENSE_SPECS[category.code]) ?? {
        label: category?.name ?? "",
        fields: [] as ExpenseFieldSpec[],
        amountEntered: true,
      },
    [category]
  );
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
  const prepaid = expensePrepaid(category?.code ?? "", details);
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
            id="categoryId"
            name="categoryId"
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={inputCls}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="spentOn" className={labelCls}>
            Expense Date
          </label>
          <DateField
            id="spentOn"
            name="spentOn"
            required
            defaultValue={initial?.spentOn ?? today}
            className={inputCls}
          />
          <p className="text-muted text-[12px] mt-1">
            When the money went out. For the record only.
          </p>
        </div>
      </div>

      {/* Ice bought on the 17th for the 16th's catch belongs to the 16th —
          that is the day whose profit it has to come out of. */}
      <div className="max-w-xs">
        <label htmlFor="date" className={labelCls}>
          Purchase Date
        </label>
        <DateField
          id="date"
          name="date"
          required
          defaultValue={initial?.date ?? today}
          className={inputCls}
        />
        <p className="text-muted text-[12px] mt-1">
          Which day&apos;s fish this cost was for. The ledger, the Day Book and
          every report use this date.
        </p>
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

      {/* An itemised category — "Other ₹4,300" tells nobody anything a month
          later. The lines sum into `amount`, which stays the single figure
          every report reads, so the detail is additive and no report has to
          know whether a voucher was itemised. */}
      {category?.allowsLines ? (
        <div className="border border-line-strong bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left font-semibold px-2 py-2">
                  Description
                </th>
                <th className="text-right font-semibold px-2 py-2 w-40">
                  Amount (₹)
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {itemLines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-1 py-1">
                    <input
                      name="lineDescription"
                      aria-label={`Description, row ${i + 1}`}
                      value={l.description}
                      onChange={(e) =>
                        setItemLine(i, { description: e.target.value })
                      }
                      className={inputCls}
                      placeholder="What it was for"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      name="lineAmount"
                      aria-label={`Amount, row ${i + 1}`}
                      inputMode="decimal"
                      value={l.amount}
                      onChange={(e) =>
                        setItemLine(i, { amount: e.target.value })
                      }
                      className={inputCls + " num text-right"}
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    {itemLines.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setItemLines((ls) => ls.filter((_, j) => j !== i))
                        }
                        aria-label={`Remove row ${i + 1}`}
                        className="text-muted hover:text-debit px-1"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong">
                <td className="px-2 py-2 font-semibold">Total</td>
                <td className="px-2 py-2 num text-right font-semibold text-debit">
                  {fmtMoney(itemTotal)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="px-2 py-2 border-t border-line">
            <button
              type="button"
              onClick={() =>
                setItemLines((ls) => [...ls, { description: "", amount: "" }])
              }
              className="text-accent text-[13px] underline underline-offset-2"
            >
              + Add row
            </button>
          </div>
          {/* The summed total is what posts; the rows travel alongside it. */}
          <input type="hidden" name="amount" value={itemTotal || ""} />
        </div>
      ) : spec.amountEntered ? (
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
