"use client";

import { useActionState } from "react";
import { recordTripRent, type RecordRentState } from "./record-rent-actions";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

/**
 * Record the rent for a trip BFM settles directly — factory, fish mill, local.
 *
 * Shown on the trip once it is back, because that is when the driver reports
 * his kilometres and the total finally exists. A market trip has no such form:
 * its last stop records the rent on the bill it was deducted from.
 */
export function RecordRentForm({
  deliveryNoteId,
  advancePaid,
  transporterName,
  existingRent,
}: {
  deliveryNoteId: string;
  advancePaid: number;
  transporterName: string;
  /** Already recorded — the form then offers a correction. */
  existingRent: number | null;
}) {
  const [state, formAction, pending] = useActionState<RecordRentState, FormData>(
    recordTripRent.bind(null, deliveryNoteId),
    null
  );

  return (
    <form
      action={formAction}
      className="border border-line-strong bg-surface px-4 py-3 mb-4"
    >
      <h2 className="heading text-[15px] font-semibold mb-1">
        {existingRent ? "Correct the rent" : "Record the rent"}
      </h2>
      <p className="text-muted text-[12px] mb-3">
        {existingRent ? (
          <>
            Recorded at{" "}
            <span className="num font-semibold">{existingRent}</span>. Saving
            again replaces it — the old entries and the expense go with it.
          </>
        ) : (
          <>
            The driver has reported his kilometres. {transporterName} is
            credited the whole rent and paid whatever he took on his return; the
            cost lands on this trip&rsquo;s buying day.
            {advancePaid > 0 && (
              <>
                {" "}
                An advance of{" "}
                <span className="num font-semibold">{advancePaid}</span> already
                went at departure.
              </>
            )}
          </>
        )}
      </p>

      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <label htmlFor="rentTotal" className={labelCls}>
            Total rent (₹)
          </label>
          <input
            id="rentTotal"
            name="rentTotal"
            inputMode="decimal"
            required
            defaultValue={existingRent ?? ""}
            className={inputCls + " num text-right"}
          />
        </div>
        <div>
          <label htmlFor="paidNow" className={labelCls}>
            Paid on return (₹)
          </label>
          <input
            id="paidNow"
            name="paidNow"
            inputMode="decimal"
            placeholder="the balance"
            className={inputCls + " num text-right"}
          />
          {/* Blank is the normal case — he takes the rest and the transporter
              closes at zero. A smaller figure leaves the remainder genuinely
              owed, which the outstanding screen then shows. */}
          <p className="text-muted text-[12px] mt-1">
            Leave blank if he took the balance in full.
          </p>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white px-5 py-2 text-[13px] font-semibold disabled:opacity-60"
        >
          {pending ? "Saving…" : existingRent ? "Replace" : "Record rent"}
        </button>
      </div>

      {state?.error && (
        <p className="text-debit text-[13px] mt-2">{state.error}</p>
      )}
    </form>
  );
}
