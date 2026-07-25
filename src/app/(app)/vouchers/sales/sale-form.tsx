"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { SaleType } from "@/generated/prisma/enums";
import { fmtMoney } from "@/lib/format";
import type { SaleFormState } from "./actions";

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
  billNo: string;
  date: string;
  buyerName: string;
  careOfName: string;
  amountReceived: string;
  place: string;
  totalBill: string;
  netBill: string;
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

const TYPE_LABELS: Record<SaleType, string> = {
  MARKET: "Market",
  FISH_MILL: "Fish Mill",
  FACTORY: "Factory",
  LOCAL: "Local",
};

export function SaleForm({
  type,
  action,
  initial,
  submitLabel,
}: {
  type: SaleType;
  action: (prev: SaleFormState, formData: FormData) => Promise<SaleFormState>;
  initial?: SaleInit;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<SaleFormState, FormData>(
    action,
    null
  );
  const today = new Date().toISOString().slice(0, 10);
  const hasLines = type === "FISH_MILL" || type === "LOCAL";
  const [lines, setLines] = useState<SaleLineInit[]>(
    initial?.lines?.length ? initial.lines : [BLANK_LINE]
  );
  const [totalBill, setTotalBill] = useState(initial?.totalBill ?? "");
  const [netBill, setNetBill] = useState(initial?.netBill ?? "");
  const [factoryAmount, setFactoryAmount] = useState(initial?.amount ?? "");
  const [received, setReceived] = useState(initial?.amountReceived ?? "");

  const setLine = (i: number, patch: Partial<SaleLineInit>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const lineTotal = useMemo(
    () => lines.reduce((s, l) => s + n(l.qtyKg) * n(l.ratePerKg), 0),
    [lines]
  );
  const boxTotal = useMemo(
    () => lines.reduce((s, l) => s + n(l.box), 0),
    [lines]
  );

  // The sale amount (what posts to the ledger) depends on the type.
  const amount =
    type === "MARKET"
      ? n(netBill)
      : type === "FACTORY"
        ? n(factoryAmount)
        : lineTotal;
  const commission = type === "MARKET" ? n(totalBill) * 0.02 : 0;
  const balance = amount - n(received);

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
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
          <label htmlFor="date" className={labelCls}>
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            defaultValue={initial?.date ?? today}
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="buyerName" className={labelCls}>
            {type === "MARKET" ? "Seller Name" : "Party Name"}
          </label>
          <input
            id="buyerName"
            name="buyerName"
            required
            defaultValue={initial?.buyerName ?? ""}
            className={inputCls}
          />
        </div>
        {(type === "FISH_MILL" || type === "FACTORY") && (
          <div>
            <label htmlFor="careOfName" className={labelCls}>
              CareOf (optional)
            </label>
            <input
              id="careOfName"
              name="careOfName"
              defaultValue={initial?.careOfName ?? ""}
              placeholder="Agent name — ledger posts here instead"
              className={inputCls}
            />
          </div>
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
                className={inputCls + " num text-right"}
              />
              <p className="text-muted text-[12px] mt-1">
                What the seller pays us — posts to the ledger.
              </p>
            </div>
          </div>
          <div className="border border-line bg-surface px-4 py-2 text-[13px] flex justify-between">
            <span className="text-muted">Commission (2% of Total Bill)</span>
            <span className="num">{fmtMoney(commission)}</span>
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
                  <th className="text-right font-semibold px-2 py-2 w-24">Kgs</th>
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
                  const rowTotal = n(l.qtyKg) * n(l.ratePerKg);
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
                  <td className="px-3 py-2 text-right" colSpan={type === "FISH_MILL" ? 3 : 2}>
                    Total
                  </td>
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

      {/* ---- Payment ---- */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="amountReceived" className={labelCls}>
            Amount Received (₹)
          </label>
          <input
            id="amountReceived"
            name="amountReceived"
            inputMode="decimal"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            className={inputCls + " num text-right"}
          />
        </div>
        <div className="flex items-end">
          <div className="w-full border border-line bg-surface px-4 py-2 text-[13px] flex justify-between">
            <span className="text-muted">Balance {type === "MARKET" ? "(Net Bill − received)" : "(amount − received)"}</span>
            <span className={"num font-semibold " + (balance > 0 ? "text-debit" : "")}>
              {fmtMoney(balance)}
            </span>
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="bill" className={labelCls}>
          {TYPE_LABELS[type]} bill image (optional)
        </label>
        <input id="bill" name="bill" type="file" accept="image/jpeg,image/png,image/webp" className="text-[13px]" />
      </div>

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
