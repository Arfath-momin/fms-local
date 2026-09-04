"use client";

import { useStickyFields } from "../use-sticky-fields";

import { DuplicateRow, duplicateAt } from "../duplicate-row";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { DeliveryFormState } from "./actions";
import { businessToday } from "@/lib/format";
import type { PackType } from "@/generated/prisma/enums";
import { PACK_LABELS, PACK_TYPES } from "@/lib/pack";
import type { FormScope } from "@/lib/scope";
import { BillUpload } from "../bill-upload";
import { ScopeFields } from "../scope-fields";
import { DateField } from "../../date-field";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export type DeliveryLineInit = {
  /** Box, big box or loose — see PackType. */
  pack: PackType;
  particulars: string;
  /** The weight of ONE box. Loose rows carry the whole weight here. */
  kgPerBox: string;
  box: string;
  pcs: string;
};

export type DeliveryInit = {
  /** Free-form remark, on every voucher type. */
  notes: string;
  billNo: string;
  date: string;
  recipient: string;
  vehicleId: string;
  /** MARKET only — paid to the driver before departure. */
  advancePaid: string;
  driverName: string;
  mobileNo: string;
  lines: DeliveryLineInit[];
};

const BLANK_LINE: DeliveryLineInit = {
  pack: "BOX",
  particulars: "",
  kgPerBox: "",
  box: "",
  pcs: "",
};

const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** A vehicle as the trip form needs it — id to post, number and owner to read. */
export type VehicleOption = {
  id: string;
  number: string;
  transporterName: string;
};

export function DeliveryForm({
  action,
  vehicles,
  nextNo,
  initial,
  submitLabel,
  existingAttachments = 0,
  allowBillUpload = true,
  scope,
}: {
  action: (
    prev: DeliveryFormState,
    formData: FormData
  ) => Promise<DeliveryFormState>;
  /** Live vehicles for the active company, in number order. */
  vehicles: VehicleOption[];
  /** The number this note will take — a preview, confirmed on save. */
  nextNo?: string;
  initial?: DeliveryInit;
  submitLabel: string;
  existingAttachments?: number;
  /** False once the voucher exists — the Attachments panel handles images then. */
  allowBillUpload?: boolean;
  scope: FormScope;
}) {
  const [state, formAction, pending] = useActionState<DeliveryFormState, FormData>(
    action,
    null
  );

  // Keeps what was typed when a save comes back with an error — React 19
  // resets an uncontrolled form once its action returns, and a rejected
  // voucher would otherwise lose the bill number along with the mistake.
  const { field } = useStickyFields();
  const [lines, setLines] = useState<DeliveryLineInit[]>(
    initial?.lines?.length ? initial.lines : [BLANK_LINE]
  );
  // Controlled: the advance field exists only on a market trip, because on
  const today = businessToday();

  // The crates on a line — none at all when it is loose, which is why a loose
  // row cannot be counted as zero crates and quietly balance.
  const rowBox = (l: DeliveryLineInit) =>
    l.pack === "LOOSE" ? 0 : num(l.box);

  // The line's weight, worked out from what the merchant actually knows at
  // loading: what ONE box weighs, times how many went. A loose row has no boxes
  // to multiply, so its weight counts once.
  const rowTotalKg = (l: DeliveryLineInit) => {
    const boxes = rowBox(l);
    return boxes > 0 ? num(l.kgPerBox) * boxes : num(l.kgPerBox);
  };

  // Summing a handful of rows costs nothing, and hand-memoising it only earned
  // a stale-dependency warning. The compiler memoises it better than the hint.
  const totals = lines.reduce(
    (acc, l) => ({
      totalKg: acc.totalKg + rowTotalKg(l),
      box: acc.box + rowBox(l),
      pcs: acc.pcs + num(l.pcs),
    }),
    { totalKg: 0, box: 0, pcs: 0 }
  );

  const setLine = (i: number, patch: Partial<DeliveryLineInit>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const cell =
    "px-2 py-1 border border-line-strong bg-surface text-sm outline-none focus:border-accent num text-right w-full";

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      <ScopeFields scope={scope} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Note No.</label>
          {/* Issued by the system, not typed. A delivery note is BFM's own
              document, so the number is ours — and two clerks entering at once
              must not be able to produce the same one. */}
          <div className="border border-line bg-background px-3 py-2 text-sm num">
            {initial?.billNo || nextNo || "DN-…"}
          </div>
          {!initial?.billNo && (
            <p className="text-muted text-[12px] mt-1">
              Next in the series — confirmed when you save.
            </p>
          )}
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="recipient" className={labelCls}>
            To
          </label>
          <input
            id="recipient"
            required
            {...field("recipient", initial?.recipient ?? "")}
            placeholder="Recipient name / place"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="vehicleId" className={labelCls}>
            Vehicle
          </label>
          {/* A picker, not free text. The same truck typed three ways used to
              be three trucks, none of which pointed at anyone to owe rent to.
              New trucks are added under Masters → Vehicles. */}
          <select
            id="vehicleId"
            name="vehicleId"
            required
            defaultValue={initial?.vehicleId ?? ""}
            className={inputCls}
          >
            <option value="" disabled>
              Choose a vehicle…
            </option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.number} — {v.transporterName}
              </option>
            ))}
          </select>
          {vehicles.length === 0 && (
            <p className="text-debit text-[12px] mt-1">
              No vehicles yet.{" "}
              <Link
                href="/masters/vehicles"
                className="underline underline-offset-2"
              >
                Add one under Masters
              </Link>{" "}
              before entering a trip.
            </p>
          )}
        </div>
        {/* An advance goes out on any trip. What differs is who settles
            the balance: a market trip's last stop hands the driver the rest and
            deducts it from their bill, while on a factory, mill or local trip
            he collects it from BFM when he gets back. */}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="advancePaid" className={labelCls}>
            Advance Paid (₹)
          </label>
          <input
            id="advancePaid"
            inputMode="decimal"
            {...field("advancePaid", initial?.advancePaid ?? "")}
            className={inputCls + " num text-right"}
          />
          <p className="text-muted text-[12px] mt-1">
            Handed to the driver at loading. The rest of the rent is entered
            when the bill comes back — this figure fills itself in there.
          </p>
        </div>
        <div>
          <label htmlFor="driverName" className={labelCls}>
            Driver Name
          </label>
          <input
            id="driverName"
            {...field("driverName", initial?.driverName ?? "")}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="mobileNo" className={labelCls}>
            Mobile No.
          </label>
          <input
            id="mobileNo"
            inputMode="tel"
            {...field("mobileNo", initial?.mobileNo ?? "")}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Items</label>
        <div className="items-scroll border border-line-strong bg-surface">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="items-head text-muted text-[12px] uppercase tracking-wide">
                <th className="text-left font-semibold px-2 py-2 w-28">Pack</th>
                <th className="text-left font-semibold px-3 py-2">Particulars</th>
                {/* Kg / Box first, then Box — the order the merchant's own
                    bills state it in. */}
                <th className="text-right font-semibold px-2 py-2 w-24">Kg / Box</th>
                <th className="text-right font-semibold px-2 py-2 w-20">Box</th>
                <th className="text-right font-semibold px-2 py-2 w-24">Total Kg</th>
                <th className="text-right font-semibold px-2 py-2 w-20">Pcs</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-1 py-1">
                    <select
                      name="pack"
                      value={l.pack}
                      onChange={(e) =>
                        setLine(i, {
                          pack: e.target.value as PackType,
                          // Loose fish goes straight onto the truck bed, so a
                          // box count left over from the previous choice would
                          // be counted as crates that never existed.
                          box: e.target.value === "LOOSE" ? "" : l.box,
                        })
                      }
                      className={inputCls}
                    >
                      {PACK_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {PACK_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      name="particulars"
                      value={l.particulars}
                      onChange={(e) => setLine(i, { particulars: e.target.value })}
                      className={inputCls}
                      placeholder="e.g. Prawn"
                    />
                  </td>
                  {/* Kg / Box comes FIRST, because that is the order the
                      merchant's own bills state it: what one box weighs, then
                      how many went. Reading a paper bill onto a screen laid out
                      the other way round means transposing every line. */}
                  <td className="px-1 py-1">
                    <input
                      name="kgPerBox"
                      inputMode="decimal"
                      value={l.kgPerBox}
                      onChange={(e) => setLine(i, { kgPerBox: e.target.value })}
                      className={cell}
                    />
                  </td>
                  <td className="px-1 py-1">
                    {/* readOnly, never a <span>. The rows travel as repeated
                        `box` fields paired up BY POSITION, so a row that sends
                        nothing shifts every row after it — a note mixing a
                        loose row with boxed ones would have quietly given one
                        row's boxes to another. The server zeroes a loose row's
                        boxes regardless, so what is sent here cannot matter;
                        what matters is that something is sent. */}
                    <input
                      name="box"
                      inputMode="numeric"
                      readOnly={l.pack === "LOOSE"}
                      tabIndex={l.pack === "LOOSE" ? -1 : undefined}
                      value={l.pack === "LOOSE" ? "" : l.box}
                      onChange={(e) => setLine(i, { box: e.target.value })}
                      className={
                        cell + (l.pack === "LOOSE" ? " text-muted bg-background" : "")
                      }
                      placeholder={l.pack === "LOOSE" ? "—" : undefined}
                    />
                  </td>
                  {/* Derived: the per-box weight times the boxes. At loading the
                      merchant knows what one box weighs, so that is what is
                      typed and the consignment total follows. A loose row has no
                      boxes to multiply, so its weight counts once. */}
                  <td className="px-2 py-1 num text-right text-muted">
                    {rowTotalKg(l) ? rowTotalKg(l).toFixed(3) : ""}
                  </td>
                  <td className="px-1 py-1">
                    <input
                      name="pcs"
                      inputMode="numeric"
                      value={l.pcs}
                      onChange={(e) => setLine(i, { pcs: e.target.value })}
                      className={cell}
                    />
                  </td>
                  <td className="px-1 py-1 text-center whitespace-nowrap">
                    <DuplicateRow
                      row={i + 1}
                      onDuplicate={() =>
                        setLines((ls) => duplicateAt(ls, i, BLANK_LINE))
                      }
                    />
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setLines((ls) => ls.filter((_, j) => j !== i))
                        }
                        className="text-debit text-lg leading-none px-1"
                        aria-label={`Remove row ${i + 1}`}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong font-semibold">
                <td className="px-3 py-2 text-right" colSpan={2}>
                  Total
                </td>
                {/* Kg / Box has no total worth footing — one box's weight is
                    not a quantity to add up. The boxes are. */}
                <td />
                <td className="px-2 py-2 num text-right">{totals.box || ""}</td>
                <td className="px-2 py-2 num text-right">
                  {totals.totalKg ? totals.totalKg.toFixed(3) : ""}
                </td>
                <td className="px-2 py-2 num text-right">{totals.pcs || ""}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap mt-2">
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, { ...BLANK_LINE }])}
            className="border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold hover:border-accent"
          >
            + Add item
          </button>
          <p className="text-muted text-[12px]">
            Kg is the weight of <span className="font-medium">one box</span> — 25
            kg × 10 boxes shows 250 kg.
          </p>
        </div>
      </div>

      {/* Free-form remark, on every voucher type. Read by no ledger, no
          balance and no report — it is what the entering clerk wanted the next
          person to know, and it prints on the document. */}
      <div>
        <label htmlFor="notes" className={labelCls}>
          Notes (optional)
        </label>
        <input
          id="notes"
          {...field("notes", initial?.notes ?? "")}
          className={inputCls}
        />
      </div>

      {allowBillUpload && (
        <BillUpload
          label="Delivery note / bill image"
          hint="Optional."
          existingCount={existingAttachments}
        />
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
          href="/vouchers/deliveries"
          className="text-muted text-[13px] underline underline-offset-2"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
