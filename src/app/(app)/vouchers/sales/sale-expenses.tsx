"use client";

import { fmtMoney } from "@/lib/format";

/**
 * The costs a bill reveals, entered on the bill.
 *
 * A trip's real costs are not knowable when the truck leaves. The rent depends
 * on where it ends up going; the ice and the loaders land as the day goes on.
 * They ARE known when the bill comes back — at which point the merchant is
 * already on this screen with the paper in their hand, and was being sent to a
 * different screen to type them.
 *
 * Each row becomes a real expense voucher, dated to the TRIP'S buying day, so
 * it lands in the same day's gross profit as the fish it was spent on. Nothing
 * is paid here: the vendor is credited what he is owed, and settling is a
 * Payment voucher against him, as it is everywhere else.
 *
 * Vehicle rent is the one row that knows things. Its vendor is the trip's
 * transporter — not typed, so one man's account cannot be split in two by a
 * spelling — and the advance already handed over at loading is shown against
 * it, so what is still owed is on screen before the bill is even saved.
 */

export type SaleExpenseRow = {
  categoryId: string;
  vendorName: string;
  amount: string;
  notes: string;
};

export type ExpenseCategoryOption = {
  id: string;
  code: string;
  name: string;
};

export const BLANK_EXPENSE: SaleExpenseRow = {
  categoryId: "",
  vendorName: "",
  amount: "",
  notes: "",
};

const inputCls =
  "w-full border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

const num = (v: string) => Number(String(v).replace(/,/g, "")) || 0;

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
  const rentCategoryId = categories.find((c) => c.code === "RENT")?.id ?? "";
  const isRent = (r: SaleExpenseRow) =>
    !!rentCategoryId && r.categoryId === rentCategoryId;

  const set = (i: number, patch: Partial<SaleExpenseRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const total = rows.reduce((s, r) => s + num(r.amount), 0);
  const rentTotal = rows.filter(isRent).reduce((s, r) => s + num(r.amount), 0);
  // What is still owed on the rent once the advance is taken off. Shown, never
  // stored: the transporter's ledger is the only place this figure lives.
  const rentDue = Math.max(0, rentTotal - (trip?.advancePaid ?? 0));

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
          Costs entered here are dated to this bill. Choose a trip above and
          they take the trip&rsquo;s buying day instead, and vehicle rent fills
          in its own transporter.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-muted text-[12px] uppercase tracking-wide">
                <th className="text-left font-semibold px-2 py-1 w-44">
                  Category
                </th>
                <th className="text-left font-semibold px-2 py-1">Paid to</th>
                <th className="text-right font-semibold px-2 py-1 w-28">
                  Amount
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rent = isRent(r);
                return (
                  <tr key={i} className="border-t border-line">
                    <td className="px-1 py-1">
                      <select
                        name="expCategoryId"
                        value={r.categoryId}
                        onChange={(e) =>
                          set(i, {
                            categoryId: e.target.value,
                            // Rent's vendor is the trip's transporter, so a
                            // half-typed name from the previous choice must not
                            // survive the switch.
                            vendorName:
                              e.target.value === rentCategoryId
                                ? ""
                                : r.vendorName,
                          })
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
                    </td>
                    <td className="px-1 py-1">
                      {rent ? (
                        <>
                          {/* Not an input: the transporter comes off the trip,
                              so there is nothing to type and nothing to spell
                              differently from last time. */}
                          <span className="text-[13px]">
                            {trip?.transporterName ?? (
                              <span className="text-debit">
                                Choose a trip first
                              </span>
                            )}
                          </span>
                          <input
                            type="hidden"
                            name="expVendorName"
                            value={trip?.transporterName ?? ""}
                          />
                        </>
                      ) : (
                        <input
                          name="expVendorName"
                          value={r.vendorName}
                          onChange={(e) => set(i, { vendorName: e.target.value })}
                          className={inputCls}
                          placeholder="Vendor — leave blank if nobody is owed"
                        />
                      )}
                    </td>
                    <td className="px-1 py-1">
                      <input
                        name="expAmount"
                        inputMode="decimal"
                        value={r.amount}
                        onChange={(e) => set(i, { amount: e.target.value })}
                        className={inputCls + " num text-right"}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                        className="text-muted hover:text-debit text-lg leading-none"
                        aria-label="Remove this expense"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 mt-2">
        <button
          type="button"
          onClick={() => setRows([...rows, BLANK_EXPENSE])}
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

      {rentTotal > 0 && trip && (
        <p className="text-muted text-[12px] mt-2">
          Rent {fmtMoney(rentTotal)} less the {fmtMoney(trip.advancePaid)}{" "}
          advance leaves{" "}
          <span className="num font-semibold">{fmtMoney(rentDue)}</span> owed to{" "}
          {trip.transporterName}. Nothing is paid here — settle it with a
          Payment voucher.
        </p>
      )}
    </div>
  );
}

/** The rent on these rows, for the market bill's deduction line. */
export function rentOn(
  rows: SaleExpenseRow[],
  categories: ExpenseCategoryOption[]
): number {
  const rentId = categories.find((c) => c.code === "RENT")?.id;
  if (!rentId) return 0;
  return rows
    .filter((r) => r.categoryId === rentId)
    .reduce((s, r) => s + num(r.amount), 0);
}
