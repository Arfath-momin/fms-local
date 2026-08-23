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
  commissionRate: string;
  reserve: string;
  /** Typed from the market's paper bill; labour/other balances against it. */
  netBill: string;
  /** The trip this bill came off. Required on MARKET/FACTORY/FISH_MILL. */
  deliveryNoteId: string;
  carriesRent: boolean;
  /** The TRIP's whole rent, reported by the driver on the last stop. */
  rentTotal: string;
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

/** A trip as the sale form needs it, already filtered to the right channel. */
export type TripOption = {
  id: string;
  billNo: string;
  /** Buying day, "YYYY-MM-DD" — the sale copies it rather than typing one. */
  date: string;
  vehicleNumber: string;
  boxesDispatched: number;
  /** Already handed to the driver at departure. Total rent − this = deducted. */
  advancePaid: number;
  /** True when another bill on this trip already recorded the rent. */
  rentAlreadyRecorded: boolean;
  /** What is still unbilled on this trip, by particular. */
  remaining: { particular: string; box: number; kg: number }[];
};

export function SaleForm({
  type,
  action,
  trips,
  initial,
  submitLabel,
  existingAttachments = 0,
  allowBillUpload = true,
  scope,
}: {
  type: SaleType;
  action: (prev: SaleFormState, formData: FormData) => Promise<SaleFormState>;
  /** Open trips for this company, centre and channel. Empty for LOCAL. */
  trips: TripOption[];
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
  // MARKET is in here now: a market bill is counted in boxes, and those box
  // counts are what tally against the boxes the trip dispatched. Without them
  // there is no way to know which market took how much of the load.
  const hasLines =
    type === "FISH_MILL" || type === "LOCAL" || type === "MARKET";
  const [lines, setLines] = useState<SaleLineInit[]>(
    initial?.lines?.length ? initial.lines : [BLANK_LINE]
  );
  const [totalBill, setTotalBill] = useState(initial?.totalBill ?? "");
  const [netBillRaw, setNetBillRaw] = useState(initial?.netBill ?? "");
  const [carriesRent, setCarriesRent] = useState(initial?.carriesRent ?? false);
  const [rentTotal, setRentTotal] = useState(initial?.rentTotal ?? "");
  const [tripId, setTripId] = useState(initial?.deliveryNoteId ?? "");
  // Pre-filled rather than fixed: most bills are still 2%, but the clerk can
  // type whatever this one was agreed at. An existing sale keeps its own rate.
  const [commissionRate, setCommissionRate] = useState(
    initial?.commissionRate ?? String(DEFAULT_MARKET_COMMISSION_RATE)
  );
  const [reserve, setReserve] = useState(initial?.reserve ?? "");
  const [factoryAmount, setFactoryAmount] = useState(initial?.amount ?? "");

  // LOCAL is the one channel with no truck behind it — a local buyer collects.
  const needsTrip = type !== "LOCAL";
  const trip = trips.find((t) => t.id === tripId);
  // The buying day is the trip's, copied rather than typed. A bill arriving
  // three days late still belongs to the day the fish was bought.
  const tripDate = trip?.date ?? initial?.date ?? today;

  const setLine = (i: number, patch: Partial<SaleLineInit>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /**
   * Fill the item table from what is still unbilled on the chosen trip.
   *
   * Offered as a button rather than done automatically on every trip change:
   * overwriting rows the clerk has already typed would be its own bug, and the
   * common case — the first bill off a trip — is one click either way.
   */
  const fillFromTrip = () => {
    if (!trip || trip.remaining.length === 0) return;
    setLines(
      trip.remaining.map((r) => ({
        particular: r.particular,
        box: r.box ? String(r.box) : "",
        // No weight or rate: a market line records boxes, and the money comes
        // from the net the market paid.
        qtyKg: "",
        ratePerKg: "",
        count: "",
      }))
    );
  };

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

  // Same helper the action stores with, so the figure approved on screen and
  // the figure written to the database are never two calculations.
  const commission =
    type === "MARKET" ? commissionAmount(n(totalBill), n(commissionRate)) : 0;

  // What THIS market handed the driver: the trip's whole rent less the advance
  // that already went at departure. Derived, so the two cannot disagree.
  const rentDeducted =
    carriesRent && trip ? Math.max(0, n(rentTotal) - trip.advancePaid) : 0;

  // Net is TYPED from the paper the market handed over — it is what they
  // actually paid. "Labour / other" is then the BALANCING item: the market
  // lists two or three sundry charges nobody itemises, and what is left after
  // the named deductions is exactly what those came to.
  const netBill = n(netBillRaw);
  const otherDeduction =
    n(totalBill) - commission - n(reserve) - rentDeducted - netBill;

  // The sale amount (what posts to the ledger) depends on the type.
  const amount =
    type === "MARKET"
      ? netBill
      : type === "FACTORY"
        ? n(factoryAmount)
        : lineTotal;

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      <ScopeFields scope={scope} />
      <input type="hidden" name="type" value={type} />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="billNo" className={labelCls}>
            Bill No.
          </label>
          {/* A LOCAL sale is BFM's own document — the buyer collects and there
              is no bill to copy from — so the number is issued. Market, factory
              and fish mill each bill BFM with their own number, which is the
              reference they will quote back when there is a query. */}
          {type === "LOCAL" ? (
            <div className="border border-line bg-background px-3 py-2 text-sm num text-muted">
              {initial?.billNo || "Assigned on save (LS-…)"}
            </div>
          ) : (
            <input
              id="billNo"
              name="billNo"
              required
              defaultValue={initial?.billNo ?? ""}
              className={inputCls}
            />
          )}
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

      {/* The trip this bill came off. Matching a bill to its truck on date and
          vehicle text was never reliable, so the link is explicit and required
          on every channel that goes out on a truck. */}
      {needsTrip ? (
        <div className="max-w-lg">
          <label htmlFor="deliveryNoteId" className={labelCls}>
            Trip
          </label>
          <select
            id="deliveryNoteId"
            name="deliveryNoteId"
            required
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
            className={inputCls}
          >
            <option value="" disabled>
              Choose the trip this bill came off…
            </option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.date} · {t.billNo} · {t.vehicleNumber}
                {t.boxesDispatched > 0 ? ` · ${t.boxesDispatched} boxes` : ""}
              </option>
            ))}
          </select>
          {trips.length === 0 ? (
            <p className="text-debit text-[12px] mt-1">
              No open {SALE_TYPE_LABELS[type].toLowerCase()} trips.{" "}
              <Link
                href="/vouchers/deliveries/new"
                className="underline underline-offset-2"
              >
                Enter the delivery note first
              </Link>
              .
            </p>
          ) : (
            <p className="text-muted text-[12px] mt-1">
              The buying day comes from the trip — one trip, one buying day.
            </p>
          )}
        </div>
      ) : (
        // LOCAL has no trip: the buyer collects, so the buying day is typed.
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
      )}
      {/* Posted, but never typed on a trip-linked bill: the action refuses a
          date that disagrees with the trip's. */}
      {needsTrip && <input type="hidden" name="date" value={tripDate} />}


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
                Gross, before any deduction.
              </p>
            </div>
          </div>

          {/* The market's deductions. Net Bill is DERIVED from these rather
              than typed, because the bill reads
                  total − commission − labour − reserve − rent = net
              and a typed net can disagree with its own working — which the
              ledger would then post as the seller's debt. */}
          <div className="grid grid-cols-3 gap-4">
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
                  ? `${commissionRate}% = ${fmtMoney(commission)}`
                  : "A cost the market charges us."}
              </p>
            </div>
            <div>
              <label htmlFor="reserve" className={labelCls}>
                Reserve (₹)
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
                Withheld; collected at year end.
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
                value={netBillRaw}
                onChange={(e) => setNetBillRaw(e.target.value)}
                className={inputCls + " num text-right"}
              />
              <p className="text-muted text-[12px] mt-1">
                What the market actually paid.
              </p>
            </div>
          </div>

          {/* Rent lands on exactly ONE bill per trip — the last stop. The
              driver reports the TRIP'S WHOLE rent here, because it depends on
              the kilometres he covered and nobody could know it at dispatch. */}
          <div className="border border-line bg-surface px-4 py-3">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name="carriesRent"
                checked={carriesRent}
                onChange={(e) => setCarriesRent(e.target.checked)}
                disabled={trip?.rentAlreadyRecorded && !initial?.carriesRent}
              />
              This was the last stop — the driver reported the trip&rsquo;s rent
            </label>
            {trip?.rentAlreadyRecorded && !initial?.carriesRent && (
              <p className="text-muted text-[12px] mt-1">
                Another bill on this trip already recorded the rent.
              </p>
            )}
            {carriesRent && (
              <div className="mt-2 grid grid-cols-2 gap-4 max-w-lg">
                <div>
                  <label htmlFor="rentTotal" className={labelCls}>
                    Total rent for the trip (₹)
                  </label>
                  <input
                    id="rentTotal"
                    name="rentTotal"
                    inputMode="decimal"
                    value={rentTotal}
                    onChange={(e) => setRentTotal(e.target.value)}
                    className={inputCls + " num text-right"}
                  />
                </div>
                <div className="self-end pb-1 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-muted">Advance already paid</span>
                    <span className="num">{fmtMoney(trip?.advancePaid ?? 0)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>This market paid the driver</span>
                    <span className="num">{fmtMoney(rentDeducted)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* The bill's working, read top to bottom the way the market's paper
              reads it. Labour / other is the BALANCING item — everything else
              is either typed or a percentage, and what is left between the
              total and the net they actually paid is what those sundry charges
              came to. */}
          <div className="border border-line-strong bg-surface px-4 py-3 text-[13px]">
            <Row label="Total bill" value={n(totalBill)} />
            <Row label="Less commission" value={-commission} />
            <Row label="Less reserve" value={-n(reserve)} />
            {carriesRent && (
              <Row label="Less vehicle rent" value={-rentDeducted} />
            )}
            <div
              className={
                "flex justify-between " +
                (otherDeduction < 0 ? "text-debit font-semibold" : "")
              }
            >
              <span className="text-muted">
                Less labour / other{" "}
                <span className="text-[11px]">(derived)</span>
              </span>
              <span className="num">{fmtMoney(Math.abs(otherDeduction))}</span>
            </div>
            <div className="flex justify-between border-t border-line-strong mt-1 pt-1 font-semibold">
              <span>Net bill — what the market paid</span>
              <span className="num">{fmtMoney(netBill)}</span>
            </div>
            {otherDeduction < 0 && (
              <p className="text-debit text-[12px] mt-1">
                Commission, reserve, rent and the net come to more than the
                total bill. Check the figures — labour / other cannot be
                negative.
              </p>
            )}
            {carriesRent && (
              <p className="text-muted text-[12px] mt-2">
                Revenue recognised is {fmtMoney(netBill + rentDeducted)} — the
                net plus the rent this market paid the driver on your behalf.
                The rent itself is expensed once, to the buying day.
              </p>
            )}
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

      {/* ---- Line table (Market / Fish Mill / Local) ---- */}
      {hasLines && (
        <div>
          <div className="flex items-baseline justify-between">
            <label className={labelCls}>Items</label>
            {type === "MARKET" && trip && trip.remaining.length > 0 && (
              <button
                type="button"
                onClick={fillFromTrip}
                className="text-accent text-[12px] underline underline-offset-2 mb-1"
              >
                Fill from trip ({trip.remaining.reduce((a, r) => a + r.box, 0)}{" "}
                boxes still unbilled)
              </button>
            )}
          </div>
          <div className="overflow-x-auto border border-line-strong bg-surface">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-muted text-[12px] uppercase tracking-wide">
                  {(type === "FISH_MILL" || type === "MARKET") && (
                    <th className="text-right font-semibold px-2 py-2 w-16">Box</th>
                  )}
                  <th className="text-left font-semibold px-3 py-2">
                    {type === "FISH_MILL" ? "Fish (variety)" : "Particular"}
                  </th>
                  {/* A market line carries no weight or rate: the money on a
                      market bill is the net the market paid, and the line is
                      there to record which market took how many boxes. */}
                  {type !== "MARKET" && (
                    <th className="text-right font-semibold px-2 py-2 w-24">
                      {type === "FISH_MILL" ? "Kgs / box" : "Kgs"}
                    </th>
                  )}
                  {type === "FISH_MILL" && (
                    <th className="text-right font-semibold px-2 py-2 w-24">
                      Total Kg
                    </th>
                  )}
                  {type !== "MARKET" && (
                    <th className="text-right font-semibold px-2 py-2 w-24">Rate/kg</th>
                  )}
                  {type === "FISH_MILL" && (
                    <th className="text-right font-semibold px-2 py-2 w-16">Count</th>
                  )}
                  {type !== "MARKET" && (
                    <th className="text-right font-semibold px-3 py-2 w-28">Total</th>
                  )}
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const totalKg = rowKg(l);
                  const rowTotal = totalKg * n(l.ratePerKg);
                  return (
                    <tr key={i} className="border-t border-line">
                      {(type === "FISH_MILL" || type === "MARKET") && (
                        <td className="px-1 py-1">
                          <input name="box" inputMode="numeric" value={l.box} onChange={(e) => setLine(i, { box: e.target.value })} className={cell} />
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <input name="particular" value={l.particular} onChange={(e) => setLine(i, { particular: e.target.value })} className={inputCls} placeholder="e.g. Prawn" />
                      </td>
                      {type !== "MARKET" && (
                        <td className="px-1 py-1">
                          <input name="qtyKg" inputMode="decimal" value={l.qtyKg} onChange={(e) => setLine(i, { qtyKg: e.target.value })} className={cell} />
                        </td>
                      )}
                      {/* Derived, not typed: box × kgs. Read-only so it can
                          never disagree with the two figures above it. */}
                      {type === "FISH_MILL" && (
                        <td className="px-2 py-1 num text-right text-muted">
                          {totalKg ? fmtKg(totalKg) : ""}
                        </td>
                      )}
                      {type !== "MARKET" && (
                        <td className="px-1 py-1">
                          <input name="ratePerKg" inputMode="decimal" value={l.ratePerKg} onChange={(e) => setLine(i, { ratePerKg: e.target.value })} className={cell} />
                        </td>
                      )}
                      {type === "FISH_MILL" && (
                        <td className="px-1 py-1">
                          <input name="count" inputMode="numeric" value={l.count} onChange={(e) => setLine(i, { count: e.target.value })} className={cell} />
                        </td>
                      )}
                      {type !== "MARKET" && (
                        <td className="px-3 py-1 num text-right text-muted">{fmtMoney(rowTotal)}</td>
                      )}
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
                  {(type === "FISH_MILL" || type === "MARKET") && (
                    <td className="px-2 py-2 num text-right">{boxTotal || ""}</td>
                  )}
                  <td className="px-3 py-2 text-right" colSpan={type === "MARKET" ? 1 : 2}>
                    {type === "MARKET" ? "Boxes" : "Total"}
                  </td>
                  {type === "FISH_MILL" && (
                    <td className="px-2 py-2 num text-right">
                      {kgTotal ? fmtKg(kgTotal) : ""}
                    </td>
                  )}
                  {type === "FISH_MILL" && <td />}
                  {/* A market bill's money is the net the market paid, so
                      there is no line total to foot to — only the boxes. */}
                  {type !== "MARKET" && (
                    <td className="px-3 py-2 num text-right text-credit">{fmtMoney(lineTotal)}</td>
                  )}
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

/** One line of the market bill's working. Negative values read as deductions. */
function Row({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="num">{fmtMoney(Math.abs(value))}</span>
    </div>
  );
}
