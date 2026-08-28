"use client";


import {
  expenseEntryAmount,
  expenseEntryVendor,
  specFor,
  type ExpenseLineInput,
} from "@/lib/expense-entry";
import { fmtMoney } from "@/lib/format";
import { PartyCombobox } from "../../masters/party-combobox";

/**
 * One expense, filled in properly, without leaving the bill.
 *
 * The panel used to take a head, a name and an amount — and that was the whole
 * of it, so every cost entered on a sale had to be opened again under Vouchers
 * → Expenses to get its actual detail in. Two visits to record one thing.
 *
 * This is the same entry shape the Expenses voucher uses, in a drawer: pick the
 * head, fill in ice's blocks and rate per block or loaders' boxes and rate per
 * box, close it, add another. The arithmetic comes from src/lib/expense-entry —
 * shared with the voucher, because two copies of "ice is blocks × rate" is
 * exactly the pair that drifts, and the day they disagree the ledger is wrong
 * and nothing says so.
 *
 * Nothing is written until the SALE is saved. The drawer edits a row in memory;
 * the bill's own save is what turns the rows into expense vouchers, in the same
 * transaction as the sale, so a bill that fails to save leaves no costs behind.
 */

export type ExpenseCategoryOption = {
  id: string;
  code: string;
  name: string;
  allowsLines: boolean;
};

export type SaleExpenseRow = {
  categoryId: string;
  /** Every field the category asks for, keyed by field name. */
  details: Record<string, string>;
  /** Typed only where the category has no formula; otherwise derived. */
  amount: string;
  lines: ExpenseLineInput[];
};

export const BLANK_EXPENSE: SaleExpenseRow = {
  categoryId: "",
  details: {},
  amount: "",
  lines: [{ description: "", amount: "" }],
};

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

/** What a trip tells a Vehicle Rent row. None of it is typed. */
export type RentPrefill = {
  vehicleNumber: string;
  transporterName: string;
  advancePaid: number;
};

export function ExpenseDrawer({
  row,
  setRow,
  categories,
  rent,
  onClose,
  onRemove,
}: {
  row: SaleExpenseRow;
  setRow: (row: SaleExpenseRow) => void;
  categories: ExpenseCategoryOption[];
  /** Present when a trip is chosen, so rent can fill itself in. */
  rent: RentPrefill | null;
  onClose: () => void;
  onRemove: () => void;
}) {
  const category = categories.find((c) => c.id === row.categoryId);
  const spec = category ? specFor(category) : null;
  const isRent = category?.code === "RENT";

  const setDetail = (name: string, value: string) =>
    setRow({ ...row, details: { ...row.details, [name]: value } });

  // Vehicle rent's transporter and advance are DISPLAYED from the trip and
  // never stored here. The server fills them in from the trip itself when the
  // bill saves — it is the only party that can be trusted to say who a trip's
  // transporter is, and a client-sent name would be one more way for one man's
  // account to end up spelled two ways.
  // The truck, its owner and what has already gone to the driver are all facts
  // about the TRIP. Asking for any of them again is asking the clerk to retype
  // something the app is already showing them two inches higher up.
  const rentDetails: Record<string, string> =
    isRent && rent
      ? {
          vehicleNo: rent.vehicleNumber,
          transporter: rent.transporterName,
          advance: rent.advancePaid > 0 ? String(rent.advancePaid) : "",
        }
      : {};

  const result = category
    ? expenseEntryAmount(
        category,
        { ...row.details, ...rentDetails },
        row.amount,
        row.lines
      )
    : null;

  const total = result && "amount" in result ? Number(result.amount) : 0;

  return (
    <div className="border border-accent bg-surface px-4 py-3 mb-2">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <label className={labelCls + " mb-0"}>
          {category ? category.name : "New expense"}
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted hover:text-debit text-[12px] underline underline-offset-2"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Head</label>
          <select
            value={row.categoryId}
            onChange={(e) =>
              // A different head asks different questions, so the answers to the
              // last one are dropped rather than carried into fields that no
              // longer mean what they meant.
              setRow({ ...BLANK_EXPENSE, categoryId: e.target.value })
            }
            className={inputCls}
          >
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {spec?.fields.map((f) => {
          // Rent's transporter and advance are the trip's, shown but not typed.
          const fromTrip = isRent && rent && f.name in rentDetails;
          if (fromTrip) {
            const value = rentDetails[f.name] ?? "";
            return (
              <div key={f.name}>
                <span className={labelCls}>{f.label}</span>
                <p className="text-[14px] font-medium py-2">
                  {f.name === "advance" && value
                    ? fmtMoney(Number(value))
                    : value || "—"}
                  <span className="text-muted font-normal text-[12px]">
                    {" "}
                    · from the trip
                  </span>
                </p>
              </div>
            );
          }

          if (f.name === spec.vendorFrom) {
            return (
              <PartyCombobox
                key={f.name}
                name={`drawer-${f.name}`}
                label={f.label}
                required={false}
                types={[
                  spec.vendorType === "TRANSPORTER"
                    ? "TRANSPORTER"
                    : "EXPENSE_VENDOR",
                ]}
                defaultType={
                  spec.vendorType === "TRANSPORTER"
                    ? "TRANSPORTER"
                    : "EXPENSE_VENDOR"
                }
                expenseCategoryId={row.categoryId || undefined}
                value={row.details[f.name] ?? ""}
                onValueChange={(v) => setDetail(f.name, v)}
              />
            );
          }

          return (
            <div key={f.name}>
              <label className={labelCls}>
                {f.label}
                {!f.required && (
                  <span className="normal-case font-normal"> (optional)</span>
                )}
              </label>
              <input
                inputMode={f.kind === "number" ? "decimal" : undefined}
                value={row.details[f.name] ?? ""}
                onChange={(e) => setDetail(f.name, e.target.value)}
                className={
                  inputCls + (f.kind === "number" ? " num text-right" : "")
                }
              />
            </div>
          );
        })}

        {/* Categories with no formula take the figure directly. */}
        {spec?.amountEntered && !category?.allowsLines && (
          <div>
            <label className={labelCls}>Total (₹)</label>
            <input
              inputMode="decimal"
              value={row.amount}
              onChange={(e) => setRow({ ...row, amount: e.target.value })}
              className={inputCls + " num text-right"}
            />
          </div>
        )}
      </div>

      {/* An itemised head — "Other ₹4,300" tells nobody anything a month later. */}
      {category?.allowsLines && (
        <div className="mt-3">
          <label className={labelCls}>Items</label>
          <div className="border border-line-strong">
            {row.lines.map((l, i) => (
              <div key={i} className="flex gap-2 p-1 border-b border-line last:border-0">
                <input
                  value={l.description}
                  onChange={(e) =>
                    setRow({
                      ...row,
                      lines: row.lines.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x
                      ),
                    })
                  }
                  placeholder="What it was for"
                  className={inputCls + " flex-1"}
                />
                <input
                  inputMode="decimal"
                  value={l.amount}
                  onChange={(e) =>
                    setRow({
                      ...row,
                      lines: row.lines.map((x, j) =>
                        j === i ? { ...x, amount: e.target.value } : x
                      ),
                    })
                  }
                  className={inputCls + " num text-right w-32"}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setRow({
                ...row,
                lines: [...row.lines, { description: "", amount: "" }],
              })
            }
            className="text-accent text-[12px] underline underline-offset-2 mt-1"
          >
            + add a row
          </button>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 mt-3 pt-2 border-t border-line">
        <span className="text-[13px]">
          {result && "error" in result ? (
            <span className="text-debit">{result.error}</span>
          ) : total > 0 ? (
            <>
              <span className="text-muted">This expense </span>
              <span className="num font-semibold text-debit">
                {fmtMoney(total)}
              </span>
              {isRent && rent && rent.advancePaid > 0 && (
                <span className="text-muted">
                  {" · "}
                  {fmtMoney(Math.max(0, total - rent.advancePaid))} still owed
                  after the advance
                </span>
              )}
            </>
          ) : (
            <span className="text-muted">Fill it in and close.</span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          disabled={!result || "error" in result}
          className="border border-line-strong bg-surface px-4 py-1.5 text-[13px] font-semibold hover:border-accent disabled:opacity-50"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** A finished row, one line, for the list behind the drawer. */
export function expenseRowSummary(
  row: SaleExpenseRow,
  categories: ExpenseCategoryOption[]
): { name: string; vendor: string; amount: number } | null {
  const category = categories.find((c) => c.id === row.categoryId);
  if (!category) return null;
  const result = expenseEntryAmount(category, row.details, row.amount, row.lines);
  return {
    name: category.name,
    vendor: expenseEntryVendor(category, row.details),
    amount: "amount" in result ? Number(result.amount) : 0,
  };
}
