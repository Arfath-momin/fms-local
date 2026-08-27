"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { DeliveryFormState } from "./actions";
import { businessToday } from "@/lib/format";
import type { FormScope } from "@/lib/scope";
import { BillUpload } from "../bill-upload";
import { ScopeFields } from "../scope-fields";
import { DateField } from "../../date-field";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export type DeliveryLineInit = {
  particulars: string;
  kg: string;
  box: string;
  bigBox: string;
  loose: string;
  pcs: string;
};

export type DeliveryInit = {
  /** Free-form remark, on every voucher type. */
  notes: string;
  billNo: string;
  date: string;
  recipient: string;
  /** Which channel this trip went to — decides how its rent settles. */
  channel: string;
  vehicleId: string;
  /** MARKET only — paid to the driver before departure. */
  driverName: string;
  mobileNo: string;
  lines: DeliveryLineInit[];
};

const BLANK_LINE: DeliveryLineInit = {
  particulars: "",
  kg: "",
  box: "",
  bigBox: "",
  loose: "",
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
  const [lines, setLines] = useState<DeliveryLineInit[]>(
    initial?.lines?.length ? initial.lines : [BLANK_LINE]
  );
  // Controlled: the advance field exists only on a market trip, because on
  // every other channel the driver is paid in full on his return.
  const [channel, setChannel] = useState(initial?.channel ?? "MARKET");
  const today = businessToday();

  // The line's TOTAL weight, as typed. At dispatch the merchant weighs the
  // consignment, not a sample box, so the total is what is actually known —
  // and the per-box average is what gets worked out from it.
  const rowKg = (l: DeliveryLineInit) => num(l.kg);
  const rowKgPerBox = (l: DeliveryLineInit) => {
    const boxes = num(l.box);
    return boxes > 0 ? num(l.kg) / boxes : 0;
  };

  const totals = useMemo(
    () =>
      lines.reduce(
        (acc, l) => ({
          totalKg: acc.totalKg + rowKg(l),
          box: acc.box + num(l.box),
          bigBox: acc.bigBox + num(l.bigBox),
          loose: acc.loose + num(l.loose),
          pcs: acc.pcs + num(l.pcs),
        }),
        { totalKg: 0, box: 0, bigBox: 0, loose: 0, pcs: 0 }
      ),
    [lines]
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
            name="recipient"
            required
            defaultValue={initial?.recipient ?? ""}
            placeholder="Recipient name / place"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="channel" className={labelCls}>
            Channel
          </label>
          {/* Controlled, because the advance field below appears only for
              MARKET — the rent settles differently on every other channel. */}
          <select
            id="channel"
            name="channel"
            required
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className={inputCls}
          >
            <option value="MARKET">Market</option>
            <option value="FACTORY">Factory</option>
            <option value="FISH_MILL">Fish Mill</option>
            <option value="LOCAL">Local</option>
          </select>
          <p className="text-muted text-[12px] mt-1">
            Decides how the rent settles. Only a market trip takes an advance.
          </p>
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
        {/* An advance goes out on every channel. What differs is who settles
            the balance: a market trip's last stop hands the driver the rest and
            deducts it from their bill, while on a factory, mill or local trip
            he collects it from BFM when he gets back. */}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="driverName" className={labelCls}>
            Driver Name
          </label>
          <input
            id="driverName"
            name="driverName"
            defaultValue={initial?.driverName ?? ""}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="mobileNo" className={labelCls}>
            Mobile No.
          </label>
          <input
            id="mobileNo"
            name="mobileNo"
            inputMode="tel"
            defaultValue={initial?.mobileNo ?? ""}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Items</label>
        <div className="overflow-x-auto border border-line-strong bg-surface">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-muted text-[12px] uppercase tracking-wide">
                <th className="text-left font-semibold px-3 py-2">Particulars</th>
                <th className="text-right font-semibold px-2 py-2 w-24">Total Kg</th>
                <th className="text-right font-semibold px-2 py-2 w-20">Box</th>
                <th className="text-right font-semibold px-2 py-2 w-24">Kg / Box</th>
                <th className="text-right font-semibold px-2 py-2 w-24">Big Box</th>
                <th className="text-right font-semibold px-2 py-2 w-20">Loose</th>
                <th className="text-right font-semibold px-2 py-2 w-20">Pcs</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-1">
                    <input
                      name="particulars"
                      value={l.particulars}
                      onChange={(e) => setLine(i, { particulars: e.target.value })}
                      className={inputCls}
                      placeholder="e.g. Prawn"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      name="kg"
                      inputMode="decimal"
                      value={l.kg}
                      onChange={(e) => setLine(i, { kg: e.target.value })}
                      className={cell}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      name="box"
                      inputMode="numeric"
                      value={l.box}
                      onChange={(e) => setLine(i, { box: e.target.value })}
                      className={cell}
                    />
                  </td>
                  {/* Derived from the two cells beside it — total ÷ boxes —
                      so the average can never be typed out of agreement with
                      the weight actually dispatched. */}
                  <td className="px-2 py-1 num text-right text-muted">
                    {rowKgPerBox(l) ? rowKgPerBox(l).toFixed(2) : ""}
                  </td>
                  <td className="px-1 py-1">
                    <input
                      name="bigBox"
                      inputMode="numeric"
                      value={l.bigBox}
                      onChange={(e) => setLine(i, { bigBox: e.target.value })}
                      className={cell}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      name="loose"
                      inputMode="numeric"
                      value={l.loose}
                      onChange={(e) => setLine(i, { loose: e.target.value })}
                      className={cell}
                    />
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
                  <td className="px-1 py-1 text-center">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setLines((ls) => ls.filter((_, j) => j !== i))
                        }
                        className="text-debit text-lg leading-none"
                        aria-label="Remove line"
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
                <td className="px-2 py-2 num text-right">{totals.box || ""}</td>
                <td className="px-2 py-2 num text-right">{totals.totalKg || ""}</td>
                <td className="px-2 py-2 num text-right">{totals.bigBox || ""}</td>
                <td className="px-2 py-2 num text-right">{totals.loose || ""}</td>
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
          name="notes"
          defaultValue={initial?.notes ?? ""}
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
