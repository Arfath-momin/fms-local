"use client";

import { useState } from "react";
import { fmtMoney } from "@/lib/format";
import {
  BLANK_EXPENSE,
  ExpenseDrawer,
  expenseRowSummary,
  type ExpenseCategoryOption,
  type SaleExpenseRow,
} from "./expense-drawer";

export {
  BLANK_EXPENSE,
  type ExpenseCategoryOption,
  type SaleExpenseRow,
} from "./expense-drawer";

/**
 * The costs a bill reveals, entered on the bill — in full.
 *
 * A trip's real costs are not knowable when the truck leaves. The rent depends
 * on where it ends up going; the ice and the loaders land as the day goes on.
 * They ARE known when the bill comes back, at which point the merchant is
 * already on this screen with the paper in their hand.
 *
 * This panel used to take a head, a name and an amount, and nothing else — so
 * every cost entered here had to be opened AGAIN under Vouchers → Expenses to
 * record what it was actually for. Two visits to enter one thing. Each row now
 * opens a drawer carrying the same fields the Expenses voucher asks for, so ice
 * gets its blocks and rate per block here and is finished here.
 *
 * The rows travel to the server as JSON in one hidden field. Repeated form
 * inputs cannot carry a shape that differs per head — ice has five fields,
 * canteen has none — and pairing them up by array index across a dozen names is
 * the kind of thing that works until somebody adds a category.
 *
 * Nothing is written until the SALE is saved: the bill's own transaction turns
 * these into expense vouchers, so a bill that fails to save leaves no costs
 * stranded behind it.
 */

const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export function SaleExpenses({
  rows,
  setRows,
  categories,
  trip,
}: {
  rows: SaleExpenseRow[];
  setRows: (rows: SaleExpenseRow[]) => void;
  categories: ExpenseCategoryOption[];
  /** The trip these costs belong to, when one is chosen. */
  trip: {
    billNo: string;
    date: string;
    vehicleNumber: string;
    transporterName: string;
    advancePaid: number;
  } | null;
}) {
  // Which row is open. Only one at a time: this is a form inside a form, and
  // two of them open at once is how a merchant loses track of which figures
  // they were typing.
  const [openAt, setOpenAt] = useState<number | null>(null);

  const rent = trip
    ? {
        vehicleNumber: trip.vehicleNumber,
        transporterName: trip.transporterName,
        advancePaid: trip.advancePaid,
      }
    : null;

  const summaries = rows.map((r) => expenseRowSummary(r, categories));
  const total = summaries.reduce((s, x) => s + (x?.amount ?? 0), 0);

  const setRow = (i: number, row: SaleExpenseRow) =>
    setRows(rows.map((r, j) => (j === i ? row : r)));

  const removeRow = (i: number) => {
    setRows(rows.filter((_, j) => j !== i));
    setOpenAt(null);
  };

  return (
    <div className="border border-line-strong bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <label className={labelCls + " mb-0"}>Expenses for this trip</label>
        <span className="text-muted text-[12px]">optional</span>
      </div>

      {trip ? (
        <p className="text-muted text-[12px] mb-2">
          {trip.billNo} · {trip.date} · {trip.vehicleNumber} ·{" "}
          {trip.transporterName}
          {trip.advancePaid > 0 && (
            <>
              {" · advance already paid "}
              <span className="num font-semibold">
                {fmtMoney(trip.advancePaid)}
              </span>
            </>
          )}
        </p>
      ) : (
        <p className="text-muted text-[12px] mb-2">
          Costs entered here are dated to this bill. Choose a trip above and they
          take the trip&rsquo;s buying day instead, and vehicle rent fills in its
          own transporter.
        </p>
      )}

      {rows.map((row, i) =>
        openAt === i ? (
          <ExpenseDrawer
            key={i}
            row={row}
            setRow={(r) => setRow(i, r)}
            categories={categories}
            rent={rent}
            onClose={() => setOpenAt(null)}
            onRemove={() => removeRow(i)}
          />
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => setOpenAt(i)}
            className="w-full text-left border border-line bg-surface px-3 py-2 mb-2 hover:border-accent flex items-baseline justify-between gap-3 flex-wrap"
          >
            <span className="text-[13px]">
              <span className="font-medium">
                {summaries[i]?.name ?? "Unfinished expense"}
              </span>
              {summaries[i]?.vendor && (
                <span className="text-muted"> · {summaries[i]!.vendor}</span>
              )}
            </span>
            <span className="num text-[13px] font-semibold text-debit">
              {summaries[i]?.amount
                ? fmtMoney(summaries[i]!.amount)
                : "not filled in"}
            </span>
          </button>
        )
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 mt-1">
        <button
          type="button"
          onClick={() => {
            setRows([...rows, { ...BLANK_EXPENSE, lines: [{ description: "", amount: "" }] }]);
            setOpenAt(rows.length);
          }}
          className="text-accent text-[12px] underline underline-offset-2"
        >
          + add an expense
        </button>
        {total > 0 && (
          <span className="text-[13px]">
            <span className="text-muted">Total </span>
            <span className="num font-semibold text-debit">
              {fmtMoney(total)}
            </span>
          </span>
        )}
      </div>

      {/* What actually posts. One field, because the shape differs per head. */}
      <input type="hidden" name="expenses" value={JSON.stringify(rows)} />
    </div>
  );
}

/** The rent among these rows — the whole cost of the journey. */
export function rentOn(
  rows: SaleExpenseRow[],
  categories: ExpenseCategoryOption[]
): number {
  const rentId = categories.find((c) => c.code === "RENT")?.id;
  if (!rentId) return 0;
  return rows
    .filter((r) => r.categoryId === rentId)
    .reduce((s, r) => s + (expenseRowSummary(r, categories)?.amount ?? 0), 0);
}

/**
 * What the market handed the driver, off the rent rows' own field.
 *
 * This is the market bill's deduction line, and it is read rather than
 * inferred. Working it out as "the rent less the advance" assumed the market
 * always settles the whole balance — which made a part payment impossible to
 * record and quietly claimed the driver had been paid in full when he had not.
 */
export function paidByMarketOn(
  rows: SaleExpenseRow[],
  categories: ExpenseCategoryOption[]
): number {
  const rentId = categories.find((c) => c.code === "RENT")?.id;
  if (!rentId) return 0;
  return rows
    .filter((r) => r.categoryId === rentId)
    .reduce((s, r) => s + (Number(r.details.paidByMarket) || 0), 0);
}
