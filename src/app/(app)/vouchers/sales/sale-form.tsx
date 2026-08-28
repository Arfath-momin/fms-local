"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { SaleType } from "@/generated/prisma/enums";
import { businessToday, fmtKg, fmtMoney } from "@/lib/format";
import type { SaleFormState } from "./actions";
import type { FormScope } from "@/lib/scope";
import {
  rentOn,
  SaleExpenses,
  type ExpenseCategoryOption,
  type SaleExpenseRow,
} from "./sale-expenses";
import { BillUpload } from "../bill-upload";
import { ScopeFields } from "../scope-fields";
import { DateField } from "../../date-field";
import { PartyCombobox } from "../../masters/party-combobox";
import {
  commissionAmount,
  DEFAULT_MARKET_COMMISSION_RATE,
  SALE_BUYER_TYPE,
  SALE_TYPE_LABELS,
  saleLineKgPerBox,
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
  /** Costs entered on this bill, which become expense vouchers. */
  expenses?: SaleExpenseRow[];
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
  /** Who the rent is owed to. Taken from the trip, never typed. */
  transporterName: string;
  boxesDispatched: number;
  /** Already handed to the driver at departure. Total rent − this = deducted. */
  advancePaid: number;
  /** What is still unbilled on this trip, by particular. */
  remaining: { particular: string; box: number; kg: number }[];
};

export function SaleForm({
  type,
  action,
  trips,
  expenseCategories,
  nextNo,
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
  /** Live expense heads, for the costs this bill reveals. */
  expenseCategories: ExpenseCategoryOption[];
  /** The number a LOCAL sale will take — a preview, confirmed on save. */
  nextNo?: string;
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
  // A factory bill entered before it was itemised has an amount and no rows.
  // Re-opening one must not silently re-price it to zero, so it keeps its
  // single-amount box; only NEW factory bills are itemised. `initial` is set
  // on edit and absent on new, which is exactly the distinction.
  const factoryLumpSum =
    type === "FACTORY" && !!initial && (initial.lines?.length ?? 0) === 0;

  // MARKET is in here now: a market bill is counted in boxes, and those box
  // counts are what tally against the boxes the trip dispatched. Without them
  // there is no way to know which market took how much of the load.
  //
  // FACTORY joined for the same reason one layer along: the factory reweighs
  // and pays for what it accepts, and without rows there was no record of how
  // many BOXES went into that — so a factory trip could never be reconciled by
  // box the way a market trip is.
  const hasLines =
    type === "FISH_MILL" ||
    type === "LOCAL" ||
    type === "MARKET" ||
    (type === "FACTORY" && !factoryLumpSum);

  /** Types whose rows are boxed: a box count, a per-box weight, and a count. */
  const boxedLines = type === "FISH_MILL" || type === "FACTORY";
  const [lines, setLines] = useState<SaleLineInit[]>(
    initial?.lines?.length ? initial.lines : [BLANK_LINE]
  );
  const [totalBill, setTotalBill] = useState(initial?.totalBill ?? "");
  const [netBillRaw, setNetBillRaw] = useState(initial?.netBill ?? "");
  const [expenses, setExpenses] = useState<SaleExpenseRow[]>(
    initial?.expenses?.length ? initial.expenses : []
  );
  const [tripId, setTripId] = useState(initial?.deliveryNoteId ?? "");
  // Pre-filled rather than fixed: most bills are still 2%, but the clerk can
  // type whatever this one was agreed at. An existing sale keeps its own rate.
  const [commissionRate, setCommissionRate] = useState(
    initial?.commissionRate ?? String(DEFAULT_MARKET_COMMISSION_RATE)
  );
  const [reserve, setReserve] = useState(initial?.reserve ?? "");
  const [factoryAmount, setFactoryAmount] = useState(initial?.amount ?? "");

  // LOCAL is the one channel with no truck behind it — a local buyer collects.
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
  /**
   * Lay out what the truck still has, so the bill starts from the load.
   *
   * Naming a trip used to leave the merchant with one blank row and a number in
   * a dropdown — they retyped particulars the delivery note already held, and a
   * "Prawns" against the note's "Prawn" was a different fish as far as the box
   * tally was concerned. Now the rows arrive filled: the particulars, the boxes
   * still unbilled and the weight that goes with them, ready to be edited down
   * to whatever this stop actually took.
   *
   *   DN     50 box prawns 750 kg · 60 box mackerel 900 kg
   *   stop 1 edit to 45 / 675 and 50 / 750, save
   *   stop 2 name the same trip → 5 box prawns 75 kg · 10 box mackerel 150 kg
   *
   * Rate and count stay empty — those belong to the bill, not the load.
   *
   * `remaining` already excludes the bill being edited, so re-opening one
   * offers its own boxes back rather than counting them as spoken for.
   */
  const fillFromTrip = (from = trip) => {
    if (!from || from.remaining.length === 0) return;
    setLines(
      from.remaining.map((r) => ({
        particular: r.particular,
        box: r.box ? String(r.box) : "",
        qtyKg: r.kg ? String(r.kg) : "",
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
  // The average that falls out of the two figures actually observed — the whole
  // lot on the scale, and the boxes it was packed into.
  const rowKgPerBox = (l: SaleLineInit) =>
    saleLineKgPerBox({ qtyKg: n(l.qtyKg), box: n(l.box) });

  const lineTotal = useMemo(
    () => lines.reduce((s, l) => s + rowKg(l) * n(l.ratePerKg), 0),
    [lines]
  );
  /**
   * Particulars this bill claims more of than the trip has left.
   *
   * The same comparison the action makes, shown while the merchant is still
   * typing rather than sprung on them at save. Per particular, not on the
   * total: 30 prawn and 20 mackerel billed as 50 prawn adds up correctly and
   * is still wrong about where the fish went.
   *
   * `trip.remaining` already excludes this bill, so on an edit its own boxes
   * are available to it and re-saving what was saved before never trips this.
   */
  const overBooked = useMemo(() => {
    if (!trip) return [];
    const available = new Map(
      trip.remaining.map((r) => [r.particular.trim().toLowerCase(), r.box])
    );
    const billed = new Map<string, { name: string; box: number }>();
    for (const l of lines) {
      const box = n(l.box);
      if (box <= 0 || !l.particular.trim()) continue;
      const key = l.particular.trim().toLowerCase();
      const hit = billed.get(key);
      if (hit) hit.box += box;
      else billed.set(key, { name: l.particular.trim(), box });
    }
    const out: { name: string; billed: number; available: number }[] = [];
    for (const [key, b] of billed) {
      const left = available.get(key) ?? 0;
      if (b.box > left) out.push({ name: b.name, billed: b.box, available: left });
    }
    return out;
  }, [lines, trip]);

  const boxTotal = useMemo(
    () => lines.reduce((s, l) => s + n(l.box), 0),
    [lines]
  );
  const kgTotal = useMemo(() => lines.reduce((s, l) => s + rowKg(l), 0), [lines]);

  // Same helper the action stores with, so the figure approved on screen and
  // the figure written to the database are never two calculations.
  const commission =
    type === "MARKET" ? commissionAmount(n(totalBill), n(commissionRate)) : 0;


  // Net is TYPED from the paper the market handed over — it is what they
  // actually paid. "Labour / other" is then the BALANCING item: the market
  // lists two or three sundry charges nobody itemises, and what is left after
  // the named deductions is exactly what those came to.
  // What THIS market handed the driver: the rent entered in the expenses panel
  // less the advance that already went at loading. Derived, never typed — one
  // number does both jobs, so the cost and the deduction cannot disagree.
  const rentTotal = rentOn(expenses, expenseCategories);
  const rentDeducted = Math.max(0, rentTotal - (trip?.advancePaid ?? 0));

  const netBill = n(netBillRaw);
  const otherDeduction =
    n(totalBill) - commission - n(reserve) - rentDeducted - netBill;

  // The sale amount (what posts to the ledger) depends on the type.
  const amount =
    type === "MARKET"
      ? netBill
      : factoryLumpSum
        ? n(factoryAmount)
        : lineTotal;

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      <ScopeFields scope={scope} />
      <input type="hidden" name="type" value={type} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="billNo" className={labelCls}>
            Bill No.
          </label>
          {/* A LOCAL sale is BFM's own document — the buyer collects and there
              is no bill to copy from — so the number is issued. Market, factory
              and fish mill each bill BFM with their own number, which is the
              reference they will quote back when there is a query. */}
          {type === "LOCAL" ? (
            <>
              <div className="border border-line bg-background px-3 py-2 text-sm num">
                {initial?.billNo || nextNo || "LS-…"}
              </div>
              {!initial?.billNo && (
                <p className="text-muted text-[12px] mt-1">
                  Next in the series — confirmed when you save.
                </p>
              )}
            </>
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

      {/* The trip this bill came off, offered on EVERY kind of sale — local
          included. A local sale used to be given no picker at all, on the
          reasoning that a local buyer collects. But the fish a factory rejected
          is sold locally on the way home, off the same truck, and those boxes
          have to come off the same trip or the box statement never balances. */}
      <div className="max-w-lg">
        <label htmlFor="deliveryNoteId" className={labelCls}>
          Trip (optional)
        </label>
        <select
          id="deliveryNoteId"
          name="deliveryNoteId"
          value={tripId}
          onChange={(e) => {
            const id = e.target.value;
            setTripId(id);
            // Choosing a trip lays out its remaining load. Only on an actual
            // change, so re-opening a saved bill keeps the rows it was saved
            // with — this never fires on mount.
            fillFromTrip(trips.find((t) => t.id === id));
          }}
          className={inputCls}
        >
          <option value="">No trip — this bill stands on its own</option>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.date} · {t.billNo} · {t.vehicleNumber}
              {t.boxesDispatched > 0 ? ` · ${t.boxesDispatched} boxes` : ""}
            </option>
          ))}
        </select>
        {trips.length === 0 ? (
          <p className="text-muted text-[12px] mt-1">
            No open trips.{" "}
            <Link
              href="/vouchers/deliveries/new"
              className="underline underline-offset-2"
            >
              Enter a delivery note
            </Link>{" "}
            if this bill came off one.
          </p>
        ) : (
          <p className="text-muted text-[12px] mt-1">
            Name it and the buying day comes from the trip, and this bill&rsquo;s
            boxes count against what the truck carried.
          </p>
        )}
      </div>

      {trip ? (
        // The buying day is the trip's, posted but never typed — the action
        // refuses a date that disagrees with it. One trip, one buying day.
        <input type="hidden" name="date" value={tripDate} />
      ) : (
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


      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

          {/* The bill's working, read top to bottom the way the market's paper
              reads it. Labour / other is the BALANCING item — everything else
              is either typed or a percentage, and what is left between the
              total and the net they actually paid is what those sundry charges
              came to. */}
          <div className="border border-line-strong bg-surface px-4 py-3 text-[13px]">
            <Row label="Total bill" value={n(totalBill)} />
            <Row label="Less commission" value={-commission} />
            <Row label="Less reserve" value={-n(reserve)} />
            {rentDeducted > 0 && (
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
            {rentDeducted > 0 && (
              <p className="text-muted text-[12px] mt-2">
                Revenue recognised is {fmtMoney(netBill + rentDeducted)} — the
                net plus the {fmtMoney(rentDeducted)} this market handed the
                driver on your behalf. The rent itself is expensed once, at its
                full {fmtMoney(rentTotal)}, to the trip&rsquo;s buying day.
              </p>
            )}
          </div>
        </>
      )}

      {/* ---- Fish Mill header ---- */}
      {type === "FISH_MILL" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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
          {/* The trip already names the truck — the dropdown above prints it —
              so asking again was asking the clerk to type something the app
              knows. The field survives only for a bill with no trip. */}
          {trip ? (
            <div>
              <span className={labelCls}>Vehicle No.</span>
              <p className="text-[14px] font-medium py-2">
                {trip.vehicleNumber}
                <span className="text-muted font-normal">
                  {" "}
                  · {trip.transporterName}
                </span>
              </p>
            </div>
          ) : (
            <div>
              <label htmlFor="vehicleNo" className={labelCls}>
                Vehicle No.
              </label>
              <input id="vehicleNo" name="vehicleNo" defaultValue={initial?.vehicleNo ?? ""} className={inputCls} />
            </div>
          )}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* The trip already names the truck — the dropdown above prints it —
              so asking again was asking the clerk to type something the app
              knows. The field survives only for a bill with no trip. */}
          {trip ? (
            <div>
              <span className={labelCls}>Vehicle No.</span>
              <p className="text-[14px] font-medium py-2">
                {trip.vehicleNumber}
                <span className="text-muted font-normal">
                  {" "}
                  · {trip.transporterName}
                </span>
              </p>
            </div>
          ) : (
            <div>
              <label htmlFor="vehicleNo" className={labelCls}>
                Vehicle No.
              </label>
              <input id="vehicleNo" name="vehicleNo" defaultValue={initial?.vehicleNo ?? ""} className={inputCls} />
            </div>
          )}
          {/* Only on a bill that predates itemisation — see factoryLumpSum.
              New factory bills take their total from the rows below. */}
          {factoryLumpSum && (
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
              <p className="text-muted text-[12px] mt-1">
                This bill was entered as one figure, before factory bills
                carried rows. It stays that way — new ones are itemised.
              </p>
            </div>
          )}
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
          <div className="flex items-baseline justify-between flex-wrap gap-3">
            <label className={labelCls}>Items</label>
            {trip && trip.remaining.length > 0 && (
              <button
                type="button"
                onClick={() => fillFromTrip()}
                className="text-accent text-[12px] underline underline-offset-2 mb-1"
              >
                Reset from trip ({trip.remaining.reduce((a, r) => a + r.box, 0)}{" "}
                boxes still unbilled)
              </button>
            )}
          </div>
          <div className="overflow-x-auto border border-line-strong bg-surface">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-muted text-[12px] uppercase tracking-wide">
                  {(boxedLines || type === "MARKET") && (
                    <th className="text-right font-semibold px-2 py-2 w-16">Box</th>
                  )}
                  <th className="text-left font-semibold px-3 py-2">
                    {boxedLines ? "Fish (variety)" : "Particular"}
                  </th>
                  {/* A market line carries no weight or rate: the money on a
                      market bill is the net the market paid, and the line is
                      there to record which market took how many boxes. */}
                  {type !== "MARKET" && (
                    <th className="text-right font-semibold px-2 py-2 w-24">
                      {boxedLines ? "Total Kg" : "Kgs"}
                    </th>
                  )}
                  {boxedLines && (
                    <th className="text-right font-semibold px-2 py-2 w-24">
                      Kg / box
                    </th>
                  )}
                  {type !== "MARKET" && (
                    <th className="text-right font-semibold px-2 py-2 w-24">Rate/kg</th>
                  )}
                  {boxedLines && (
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
                      {(boxedLines || type === "MARKET") && (
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
                      {/* The AVERAGE, derived from the two figures actually
                          observed: the lot on the scale and the boxes it was
                          packed into. Read-only, because the merchant never
                          weighed a single box and should not be asked to. */}
                      {boxedLines && (
                        <td className="px-2 py-1 num text-right text-muted">
                          {rowKgPerBox(l) ? fmtKg(rowKgPerBox(l)) : ""}
                        </td>
                      )}
                      {type !== "MARKET" && (
                        <td className="px-1 py-1">
                          <input name="ratePerKg" inputMode="decimal" value={l.ratePerKg} onChange={(e) => setLine(i, { ratePerKg: e.target.value })} className={cell} />
                        </td>
                      )}
                      {boxedLines && (
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
                {/* One cell per column, in the header's order, rather than
                    colSpan arithmetic — the columns moved once and the totals
                    silently landed under the wrong headings. */}
                <tr className="border-t border-line-strong font-semibold">
                  {(boxedLines || type === "MARKET") && (
                    <td className="px-2 py-2 num text-right">{boxTotal || ""}</td>
                  )}
                  <td className="px-3 py-2 text-right">
                    {type === "MARKET" ? "Boxes" : "Total"}
                  </td>
                  {type !== "MARKET" && (
                    <td className="px-2 py-2 num text-right">
                      {kgTotal ? fmtKg(kgTotal) : ""}
                    </td>
                  )}
                  {/* No average of the averages — it would be a figure with no
                      meaning. The lot's own average is total kg ÷ total boxes,
                      which the boxes and kilos beside it already give. */}
                  {boxedLines && <td />}
                  {type !== "MARKET" && <td />}
                  {boxedLines && <td />}
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
          {overBooked.length > 0 && (
            <div className="border border-debit bg-surface px-3 py-2 mt-2 text-[13px]">
              <p className="text-debit font-semibold mb-1">
                More boxes than the trip has left
              </p>
              <ul className="text-muted space-y-0.5">
                {overBooked.map((o) => (
                  <li key={o.name}>
                    <span className="font-medium text-foreground">{o.name}</span>
                    {" — this bill claims "}
                    <span className="num">{o.billed}</span>
                    {o.available === 0
                      ? ", but the trip carried none of it"
                      : `, and only ${o.available} ${
                          o.available === 1 ? "box is" : "boxes are"
                        } still unbilled`}
                    .
                  </li>
                ))}
              </ul>
              <p className="text-muted text-[12px] mt-1">
                Correct the boxes, or correct the delivery note. Saving is
                refused while this stands.
              </p>
            </div>
          )}

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
      {/* The costs this bill reveals. Placed here, after the money, because
          that is the order the paper is read in: what they paid, then what it
          cost to get it there. */}
      <SaleExpenses
        rows={expenses}
        setRows={setExpenses}
        categories={expenseCategories}
        trip={
          trip
            ? {
                billNo: trip.billNo,
                date: trip.date,
                vehicleNumber: trip.vehicleNumber,
                transporterName: trip.transporterName,
                advancePaid: trip.advancePaid,
              }
            : null
        }
      />

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
