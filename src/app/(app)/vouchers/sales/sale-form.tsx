"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { SaleType } from "@/generated/prisma/enums";
import { businessToday, fmtKg, fmtMoney } from "@/lib/format";
import type { SaleFormState } from "./actions";
import type { FormScope } from "@/lib/scope";
import { BillUpload } from "../bill-upload";
import { ScopeFields } from "../scope-fields";
import { DateField } from "../../date-field";
import { PartyCombobox } from "../../masters/party-combobox";
import {
  commissionAmount,
  DEFAULT_MARKET_COMMISSION_RATE,
  SALE_BUYER_TYPE,
  SALE_TYPE_LABELS,
  saleLineTotalKg,
} from "@/lib/sale";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";
const cell =
  "w-full border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-accent num text-right";

export type SaleLineInit = {
  particular: string;
  box: string;
  qtyKg: string;
  ratePerKg: string;
  count: string;
};

export type SaleInit = {
  /** Free-form remark, on every voucher type. */
  notes: string;
  billNo: string;
  /** The purchase day this sale counts against. */
  date: string;
  /** When the sale happened. Record only. */
  saleDate: string;
  buyerName: string;
  careOfName: string;
  place: string;
  totalBill: string;
  netBill: string;
  commissionRate: string;
  reserve: string;
  amount: string; // factory bill amount total
  weight: string;
  vehicleNo: string;
  netWeight: string;
  placeOfLoading: string;
  returnNote: string;
  lines: SaleLineInit[];
};

const BLANK_LINE: SaleLineInit = {
  particular: "",
  box: "",
  qtyKg: "",
  ratePerKg: "",
  count: "",
};

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function SaleForm({
  type,
  action,
  initial,
  submitLabel,
  existingAttachments = 0,
  allowBillUpload = true,
  scope,
}: {
  type: SaleType;
  action: (prev: SaleFormState, formData: FormData) => Promise<SaleFormState>;
  initial?: SaleInit;
  submitLabel: string;
  existingAttachments?: number;
  /** False once the voucher exists — the Attachments panel handles images then. */
  allowBillUpload?: boolean;
  scope: FormScope;
}) {
  const [state, formAction, pending] = useActionState<SaleFormState, FormData>(
    action,
    null
  );
  const today = businessToday();
  const hasLines = type === "FISH_MILL" || type === "LOCAL";
  const [lines, setLines] = useState<SaleLineInit[]>(
    initial?.lines?.length ? initial.lines : [BLANK_LINE]
  );
  const [totalBill, setTotalBill] = useState(initial?.totalBill ?? "");
  const [netBill, setNetBill] = useState(initial?.netBill ?? "");
  // Pre-filled rather than fixed: most bills are still 2%, but the clerk can
  // type whatever this one was agreed at. An existing sale keeps its own rate.
  const [commissionRate, setCommissionRate] = useState(
    initial?.commissionRate ?? String(DEFAULT_MARKET_COMMISSION_RATE)
  );
  const [reserve, setReserve] = useState(initial?.reserve ?? "");
  const [factoryAmount, setFactoryAmount] = useState(initial?.amount ?? "");

  const setLine = (i: number, patch: Partial<SaleLineInit>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // Kgs is the weight of ONE box, so the row's real weight is box × kgs and
  // the rate applies to that. saleLineTotalKg is the same helper the server
  // action uses, so the figure on screen and the figure saved cannot disagree.
  const rowKg = (l: SaleLineInit) =>
    saleLineTotalKg({ qtyKg: n(l.qtyKg), box: n(l.box) });

  const lineTotal = useMemo(
    () => lines.reduce((s, l) => s + rowKg(l) * n(l.ratePerKg), 0),
    [lines]
  );
  const boxTotal = useMemo(
    () => lines.reduce((s, l) => s + n(l.box), 0),
    [lines]
  );
  const kgTotal = useMemo(() => lines.reduce((s, l) => s + rowKg(l), 0), [lines]);

  // The sale amount (what posts to the ledger) depends on the type.
  const amount =
    type === "MARKET"
      ? n(netBill)
      : type === "FACTORY"
        ? n(factoryAmount)
        : lineTotal;
  // Same helper the action stores with, so the figure approved on screen and
  // the figure written to the database are never two calculations.
  const commission =
    type === "MARKET" ? commissionAmount(n(totalBill), n(commissionRate)) : 0;
  const netOverTotal = n(netBill) > 0 && n(netBill) > n(totalBill);

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      <ScopeFields scope={scope} />
      <input type="hidden" name="type" value={type} />

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
          <label htmlFor="saleDate" className={labelCls}>
            Sale Date
          </label>
          <DateField
            id="saleDate"
            name="saleDate"
            required
            defaultValue={initial?.saleDate ?? today}
            className={inputCls}
          />
          <p className="text-muted text-[12px] mt-1">
            When this sale was made. For the record only.
          </p>
        </div>
      </div>

      {/* The field that decides where the money lands. Fish bought on the 16th
          and sold on the 18th belongs to the 16th, so that is the day whose
          profit it counts toward — and the day this must name. */}
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
          Which day&apos;s fish this is. The ledger, the Day Book and every
          report use this date — not the sale date above.
        </p>
      </div>


      <div className="grid grid-cols-2 gap-4">
        <PartyCombobox
          name="buyerName"
          label={type === "MARKET" ? "Seller Name" : "Party Name"}
          types={[SALE_BUYER_TYPE[type]]}
          defaultValue={initial?.buyerName ?? ""}
        />
        {(type === "FISH_MILL" || type === "FACTORY") && (
          <PartyCombobox
            name="careOfName"
            label="CareOf (optional)"
            types={["CARE_OF"]}
            required={false}
            defaultValue={initial?.careOfName ?? ""}
            placeholder="Agent name — ledger posts here instead"
          />
        )}
      </div>

      {/* ---- Market ---- */}
      {type === "MARKET" && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="place" className={labelCls}>
                Place
              </label>
              <input
                id="place"
                name="place"
                defaultValue={initial?.place ?? ""}
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
                defaultValue={initial?.vehicleNo ?? ""}
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="totalBill" className={labelCls}>
                Total Bill (₹)
              </label>
              <input
                id="totalBill"
                name="totalBill"
                inputMode="decimal"
                required
                value={totalBill}
                onChange={(e) => setTotalBill(e.target.value)}
                className={inputCls + " num text-right"}
              />
              <p className="text-muted text-[12px] mt-1">
                Gross — includes seller profit + expenses.
              </p>
            </div>
            <div>
              <label htmlFor="netBill" className={labelCls}>
                Net Bill (₹)
              </label>
              <input
                id="netBill"
                name="netBill"
                inputMode="decimal"
                required
                value={netBill}
                onChange={(e) => setNetBill(e.target.value)}
                aria-invalid={netOverTotal || undefined}
                className={
                  inputCls +
                  " num text-right" +
                  (netOverTotal ? " border-debit" : "")
                }
              />
              {/* Caught here as well as on the server: net is what posts to
                  the ledger, so an inverted pair overstates the debt, and
                  finding that out only on submit wastes the whole form. */}
              {netOverTotal ? (
                <p className="text-debit text-[12px] mt-1">
                  Net Bill cannot be more than Total Bill ({fmtMoney(n(totalBill))}).
                </p>
              ) : (
                <p className="text-muted text-[12px] mt-1">
                  What the seller pays us — posts to the ledger.
                </p>
              )}
            </div>
          </div>
          {/* Commission and reserve are the two amounts withheld from this
              bill. Neither touches Net Bill: the seller still owes the net for
              the fish, and netting a retention against it would misstate both
              the debt and the day's revenue. They post to two standing
              accounts — commission is the house's income, reserve is the
              seller's own money held back — shown together under Ledgers. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="commissionRate" className={labelCls}>
                Commission %
              </label>
              <input
                id="commissionRate"
                name="commissionRate"
                inputMode="decimal"
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
                className={inputCls + " num text-right"}
                placeholder="2"
              />
              <p className="text-muted text-[12px] mt-1">
                {n(commissionRate) > 0 && n(totalBill) > 0
                  ? `${commissionRate}% of ${fmtMoney(n(totalBill))} = ${fmtMoney(commission)}`
                  : "Leave blank for no commission on this bill."}
              </p>
            </div>
            <div>
              <label htmlFor="reserve" className={labelCls}>
                Reserve
              </label>
              <input
                id="reserve"
                name="reserve"
                inputMode="decimal"
                value={reserve}
                onChange={(e) => setReserve(e.target.value)}
                className={inputCls + " num text-right"}
                placeholder="0.00"
              />
              <p className="text-muted text-[12px] mt-1">
                Held back from the seller. Not deducted from Net Bill.
              </p>
            </div>
          </div>
        </>
      )}

      {/* ---- Fish Mill header ---- */}
      {type === "FISH_MILL" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label htmlFor="weight" className={labelCls}>
              Weight
            </label>
            <input id="weight" name="weight" inputMode="decimal" defaultValue={initial?.weight ?? ""} className={inputCls + " num text-right"} />
          </div>
          <div>
            <label htmlFor="netWeight" className={labelCls}>
              Net Weight
            </label>
            <input id="netWeight" name="netWeight" inputMode="decimal" defaultValue={initial?.netWeight ?? ""} className={inputCls + " num text-right"} />
          </div>
          <div>
            <label htmlFor="vehicleNo" className={labelCls}>
              Vehicle No.
            </label>
            <input id="vehicleNo" name="vehicleNo" defaultValue={initial?.vehicleNo ?? ""} className={inputCls} />
          </div>
          <div>
            <label htmlFor="placeOfLoading" className={labelCls}>
              Place of Loading
            </label>
            <input id="placeOfLoading" name="placeOfLoading" defaultValue={initial?.placeOfLoading ?? ""} className={inputCls} />
          </div>
        </div>
      )}

      {/* ---- Factory ---- */}
      {type === "FACTORY" && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="vehicleNo" className={labelCls}>
              Vehicle No.
            </label>
            <input id="vehicleNo" name="vehicleNo" defaultValue={initial?.vehicleNo ?? ""} className={inputCls} />
          </div>
          <div>
            <label htmlFor="amount" className={labelCls}>
              Bill Amount Total (₹)
            </label>
            <input
              id="amount"
              name="amount"
              inputMode="decimal"
              required
              value={factoryAmount}
              onChange={(e) => setFactoryAmount(e.target.value)}
              className={inputCls + " num text-right"}
            />
          </div>
          <div className="col-span-2">
            <label htmlFor="returnNote" className={labelCls}>
              Return (optional)
            </label>
            <input id="returnNote" name="returnNote" defaultValue={initial?.returnNote ?? ""} className={inputCls} />
          </div>
        </div>
      )}

      {/* ---- Line table (Fish Mill / Local) ---- */}
      {hasLines && (
        <div>
          <label className={labelCls}>Items</label>
          <div className="overflow-x-auto border border-line-strong bg-surface">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-muted text-[12px] uppercase tracking-wide">
                  {type === "FISH_MILL" && (
                    <th className="text-right font-semibold px-2 py-2 w-16">Box</th>
                  )}
                  <th className="text-left font-semibold px-3 py-2">
                    {type === "FISH_MILL" ? "Fish (variety)" : "Particular"}
                  </th>
                  <th className="text-right font-semibold px-2 py-2 w-24">
                    {type === "FISH_MILL" ? "Kgs / box" : "Kgs"}
                  </th>
                  {type === "FISH_MILL" && (
                    <th className="text-right font-semibold px-2 py-2 w-24">
                      Total Kg
                    </th>
                  )}
                  <th className="text-right font-semibold px-2 py-2 w-24">Rate/kg</th>
                  {type === "FISH_MILL" && (
                    <th className="text-right font-semibold px-2 py-2 w-16">Count</th>
                  )}
                  <th className="text-right font-semibold px-3 py-2 w-28">Total</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const totalKg = rowKg(l);
                  const rowTotal = totalKg * n(l.ratePerKg);
                  return (
                    <tr key={i} className="border-t border-line">
                      {type === "FISH_MILL" && (
                        <td className="px-1 py-1">
                          <input name="box" inputMode="numeric" value={l.box} onChange={(e) => setLine(i, { box: e.target.value })} className={cell} />
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <input name="particular" value={l.particular} onChange={(e) => setLine(i, { particular: e.target.value })} className={inputCls} placeholder="e.g. Prawn" />
                      </td>
                      <td className="px-1 py-1">
                        <input name="qtyKg" inputMode="decimal" value={l.qtyKg} onChange={(e) => setLine(i, { qtyKg: e.target.value })} className={cell} />
                      </td>
                      {/* Derived, not typed: box × kgs. Read-only so it can
                          never disagree with the two figures above it. */}
                      {type === "FISH_MILL" && (
                        <td className="px-2 py-1 num text-right text-muted">
                          {totalKg ? fmtKg(totalKg) : ""}
                        </td>
                      )}
                      <td className="px-1 py-1">
                        <input name="ratePerKg" inputMode="decimal" value={l.ratePerKg} onChange={(e) => setLine(i, { ratePerKg: e.target.value })} className={cell} />
                      </td>
                      {type === "FISH_MILL" && (
                        <td className="px-1 py-1">
                          <input name="count" inputMode="numeric" value={l.count} onChange={(e) => setLine(i, { count: e.target.value })} className={cell} />
                        </td>
                      )}
                      <td className="px-3 py-1 num text-right text-muted">{fmtMoney(rowTotal)}</td>
                      <td className="px-1 py-1 text-center">
                        {lines.length > 1 && (
                          <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-debit text-lg leading-none" aria-label="Remove line">
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong font-semibold">
                  {type === "FISH_MILL" && (
                    <td className="px-2 py-2 num text-right">{boxTotal || ""}</td>
                  )}
                  <td className="px-3 py-2 text-right" colSpan={2}>
                    Total
                  </td>
                  {type === "FISH_MILL" && (
                    <td className="px-2 py-2 num text-right">
                      {kgTotal ? fmtKg(kgTotal) : ""}
                    </td>
                  )}
                  {type === "FISH_MILL" && <td />}
                  <td className="px-3 py-2 num text-right text-credit">{fmtMoney(lineTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <button type="button" onClick={() => setLines((ls) => [...ls, { ...BLANK_LINE }])} className="mt-2 border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold hover:border-accent">
            + Add item
          </button>
        </div>
      )}

      {/* Collection is not captured here. A sale records what the party owes;
          money actually arriving is a Receipt voucher against that party, so
          part-payments and later settlement have their own dated records. */}
      <div className="border border-line bg-surface px-4 py-2 text-[13px] flex items-center justify-between gap-3">
        <span className="text-muted">
          This sale posts {fmtMoney(amount)} to the party&rsquo;s ledger.
          Record money received as a Receipt.
        </span>
        <Link
          href="/vouchers/receipts/new"
          className="text-accent underline underline-offset-2 whitespace-nowrap"
        >
          New Receipt
        </Link>
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
          label={`${SALE_TYPE_LABELS[type]} bill image`}
          hint="Optional."
          existingCount={existingAttachments}
        />
      )}

      {state?.error && <p className="text-debit text-[13px]">{state.error}</p>}

      <div className="flex gap-3 items-center">
        <button type="submit" disabled={pending} className="bg-accent text-white px-5 py-2 text-[13px] font-semibold disabled:opacity-60">
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link href="/vouchers/sales" className="text-muted text-[13px] underline underline-offset-2">
          Cancel
        </Link>
      </div>
    </form>
  );
}
