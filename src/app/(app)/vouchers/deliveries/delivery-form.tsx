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
  billNo: string;
  date: string;
  recipient: string;
  vehicleNo: string;
  advancePaid: string;
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

export function DeliveryForm({
  action,
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
  const today = businessToday();

  // Same rule as lineTotalKg() on the server: kg is the weight of one box, so
  // the row is kg × boxes — and a row shipped loose, with no boxes, counts its
  // kg once rather than being multiplied away to nothing.
  const rowKg = (l: DeliveryLineInit) => {
    const boxes = num(l.box);
    return boxes > 0 ? num(l.kg) * boxes : num(l.kg);
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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="billNo" className={labelCls}>
            Bill No.
          </label>
          <input
            id="billNo"
            name="billNo"
            required
            defaultValue={initial?.billNo ?? ""}
            className={inputCls}
          />
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

      <div className="grid grid-cols-2 gap-4">
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
          <label htmlFor="vehicleNo" className={labelCls}>
            Vehicle No.
          </label>
          <input
            id="vehicleNo"
            name="vehicleNo"
            required
            defaultValue={initial?.vehicleNo ?? ""}
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="advancePaid" className={labelCls}>
            Advance Paid (₹)
          </label>
          <input
            id="advancePaid"
            name="advancePaid"
            inputMode="decimal"
            defaultValue={initial?.advancePaid ?? ""}
            className={inputCls + " num text-right"}
          />
        </div>
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
                <th className="text-right font-semibold px-2 py-2 w-24">Kg / Box</th>
                <th className="text-right font-semibold px-2 py-2 w-20">Box</th>
                <th className="text-right font-semibold px-2 py-2 w-24">Total Kg</th>
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
                  {/* Derived, so it cannot be typed out of agreement with the
                      two cells beside it. */}
                  <td className="px-2 py-1 num text-right text-muted">
                    {rowKg(l) || ""}
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
