"use client";

import { TripPicker } from "../trip-picker";

import { useStickyFields } from "../use-sticky-fields";

import { DuplicateRow, duplicateAt } from "../duplicate-row";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { SaleType } from "@/generated/prisma/enums";
import { businessToday, fmtKg, fmtMoney } from "@/lib/format";
import type { PackType } from "@/generated/prisma/enums";
import { PACK_LABELS, PACK_TYPES } from "@/lib/pack";
import type { SaleFormState } from "./actions";
import type { FormScope } from "@/lib/scope";
import {
  paidByMarketOn,
  rentOn,
  SaleExpenses,
  type ExpenseCategoryOption,
  type SaleExpenseRow,
  type VehicleOption,
} from "./sale-expenses";
import { BillUpload } from "../bill-upload";
import { ScopeFields } from "../scope-fields";
import { DateField } from "../../date-field";
import { PartyCombobox } from "../../masters/party-combobox";
import {
  commissionAmount,
  marketOtherDeduction,
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
  /** Box, big box or loose — see PackType. */
  pack: PackType;
  particular: string;
  box: string;
  qtyKg: string;
  ratePerKg: string;
  /** MARKET: what one box weighed, carried from the delivery note. */
  kgPerBox: string;
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
  cuttingRate: string;
  reserve: string;
  /** Typed from the market's paper bill; labour/other balances against it. */
  netBill: string;
  /** The trip this bill came off. Required on MARKET/FACTORY/FISH_MILL. */
  deliveryNoteId: string;
  /** Costs entered on this bill, which become expense vouchers. */
  expenses?: SaleExpenseRow[];
  amount: string; // factory bill amount total
  /** The buyer's weighing slip. Net is derived from these two. */
  weight: string;
  /** FISH MILL: the two weighbridge readings the total comes from. */
  weightFirst: string;
  weightSecond: string;
  waterLess: string;
  /** The boxes this bill unloaded; the Items rows must add up to it. */
  totalBox: string;
  /** FACTORY types this and the total follows; elsewhere it is derived. */
  netWeight: string;
  placeOfLoading: string;
  returnNote: string;
  lines: SaleLineInit[];
};

const BLANK_LINE: SaleLineInit = {
  pack: "BOX",
  particular: "",
  box: "",
  qtyKg: "",
  ratePerKg: "",
  kgPerBox: "",
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
  remaining: { pack: PackType; particular: string; box: number; kg: number }[];
};

export function SaleForm({
  type,
  action,
  trips,
  expenseCategories,
  vehicles,
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
  /** The vehicle master, so a rent row picks its truck rather than typing it. */
  vehicles: VehicleOption[];
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

  // Keeps what was typed when a save comes back with an error — React 19
  // resets an uncontrolled form once its action returns, and a rejected
  // voucher would otherwise lose the bill number along with the mistake.
  const { field } = useStickyFields();
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

  /**
   * Fish mill and factory record how the buyer weighed the load: as it arrived,
   * after water and ice, and what came back. The Items rows below are what the
   * buyer actually TOOK, and they are what the money and the box statement
   * read — these three are the weighing slip beside them.
   */
  const weighed = type === "FISH_MILL" || type === "FACTORY";
  const [lines, setLines] = useState<SaleLineInit[]>(
    initial?.lines?.length ? initial.lines : [BLANK_LINE]
  );
  const [totalBill, setTotalBill] = useState(initial?.totalBill ?? "");
  const [netBillRaw, setNetBillRaw] = useState(initial?.netBill ?? "");
  // The buyer's weighing slip. Controlled so the reconciliation below can read
  // them while they are being typed.
  const [weightFirst, setWeightFirst] = useState(initial?.weightFirst ?? "");
  const [weightSecond, setWeightSecond] = useState(initial?.weightSecond ?? "");
  // FACTORY types the net; the total follows from it and the return.
  const [netWeightTyped, setNetWeightTyped] = useState(initial?.netWeight ?? "");
  const [waterLess, setWaterLess] = useState(initial?.waterLess ?? "");
  const [totalBox, setTotalBox] = useState(initial?.totalBox ?? "");

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
  const [cuttingRate, setCuttingRate] = useState(initial?.cuttingRate ?? "");
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
    // The boxes still unbilled on the trip are the boxes this bill is unloading
    // — offered as the count so the second stop starts from what the first one
    // left rather than from the whole load again.
    if (weighed)
      setTotalBox(
        String(from.remaining.reduce((a, r) => a + (r.pack === "LOOSE" ? 0 : r.box), 0))
      );
    setLines(
      from.remaining.map((r) => ({
        pack: r.pack,
        particular: r.particular,
        box: r.box ? String(r.box) : "",
        qtyKg: r.kg ? String(r.kg) : "",
        // What one box weighed on the note, so a market bill starts from the
        // figure the truck actually left with rather than from nothing.
        kgPerBox:
          r.pack !== "LOOSE" && r.box > 0
            ? String(Math.round((r.kg / r.box) * 1000) / 1000)
            : "",
        ratePerKg: "",
        count: "",
      }))
    );
  };

  // The net the buyer paid on: what arrived, less what they took off for water
  // and ice. Derived, never typed — three figures that can be entered
  // independently are three figures that can disagree.
  //
  // Declared HERE, above rowKg, and it has to stay above it. rowKg reads
  // avgKgPerBox, and lineTotal calls rowKg immediately — so with these two
  // sitting further down the body, rendering a weighed bill threw
  // "Cannot access 'avgKgPerBox' before initialization" and the Fish Mill and
  // Factory forms would not open at all. Market and Local were unaffected,
  // because rowKg only reaches this branch when there is a weighing slip.
  // A fish mill weighs twice — the lots with the truck, then without — and the
  // load is the difference. A factory states one figure. Either way the total
  // is working rather than something anybody quotes, which is why it stays off
  // the printed bill.
  const twoWeighings = type === "FISH_MILL";
  // A FACTORY states what it ACCEPTED and what it handed back; the total is the
  // two added. Which way round the arithmetic runs follows the paper: a mill's
  // slip gives the weighings and leaves the net to be worked out, a factory's
  // gives the net and the return.
  const factoryNetTyped = type === "FACTORY";
  // Neither channel types it any more: a mill's is the gap between its two
  // weighings, a factory's is what it accepted plus what it sent back. There is
  // no third case — only those two channels weigh at all.
  const totalWeight = twoWeighings
    ? Math.max(0, n(weightFirst) - n(weightSecond))
    : n(netWeightTyped) + n(waterLess);
  const netWeight = factoryNetTyped
    ? n(netWeightTyped)
    : Math.max(0, totalWeight - n(waterLess));

  // What one box weighs, worked out from the lot. This is the way round the
  // mill actually works: they weigh the whole consignment on arrival and
  // nobody weighs a single box. Every Items row takes its weight from it.
  const avgKgPerBox = n(totalBox) > 0 ? netWeight / n(totalBox) : 0;

  /**
   * The weight of one Items row.
   *
   * On a fish mill or factory bill it is DERIVED — the average off the weighing
   * slip, times the boxes on the row. The mill weighs the lot on arrival and
   * nobody weighs a single box, so asking for a per-row weight was asking the
   * clerk to apportion a figure the paper never broke down. A loose row has no
   * boxes to multiply, so its weight is typed as it always was.
   *
   * Local bills keep typing it: there is no weighing slip to derive from.
   */
  const rowKg = (l: SaleLineInit) => {
    if (weighed && l.pack !== "LOOSE") return avgKgPerBox * n(l.box);
    // A market bill states what one box weighed, so the row's weight is that
    // times the boxes. A loose row has no boxes to multiply and carries the
    // weight typed against it.
    if (type === "MARKET" && l.pack !== "LOOSE")
      return n(l.box) * n(l.kgPerBox);
    return saleLineTotalKg({ qtyKg: n(l.qtyKg), box: n(l.box) });
  };

  /**
   * What one row is worth.
   *
   * ZERO on a market bill, and that is not an omission. A market's money is the
   * net it paid — the total less its commission, cutting, reserve and labour —
   * and a per-row amount printed beside that invites the reader to add the rows
   * up and ask why the two figures differ. The rows record which market took
   * which fish, and how much of it.
   */
  const rowAmount = (l: SaleLineInit) =>
    type === "MARKET" ? 0 : rowKg(l) * n(l.ratePerKg);

  const lineTotal = lines.reduce((s, l) => s + rowAmount(l), 0);
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

  const boxTotal = lines.reduce(
    (s, l) => s + (l.pack === "LOOSE" ? 0 : n(l.box)),
    0
  );
  const kgTotal = lines.reduce((s, l) => s + rowKg(l), 0);

  // The Items rows have to add up to the boxes this bill unloaded. Off by any
  // amount and either the count or a row is wrong.
  const boxesOff = n(totalBox) > 0 && boxTotal !== n(totalBox);

  // Same helper the action stores with, so the figure approved on screen and
  // the figure written to the database are never two calculations.
  const commission =
    type === "MARKET" ? commissionAmount(n(totalBill), n(commissionRate)) : 0;
  // Cutting is struck the same way commission is — a percentage of the total —
  // and withheld the way reserve is. Same helper, because it is the same sum.
  const cutting =
    type === "MARKET" ? commissionAmount(n(totalBill), n(cuttingRate)) : 0;


  // Net is TYPED from the paper the market handed over — it is what they
  // actually paid. "Labour / other" is then the BALANCING item: the market
  // lists two or three sundry charges nobody itemises, and what is left after
  // the named deductions is exactly what those came to.
  // What THIS market handed the driver: the rent entered in the expenses panel
  // less the advance that already went at loading. Derived, never typed — one
  // number does both jobs, so the cost and the deduction cannot disagree.
  const rentTotal = rentOn(expenses, expenseCategories);
  // What the market actually handed the driver, off the rent row's own field —
  // not assumed to be the whole balance after the advance.
  const rentDeducted = paidByMarketOn(expenses, expenseCategories);

  const netBill = n(netBillRaw);
  // Same helper the server derives and stores with, so the figure shown while
  // typing and the figure saved can never be two calculations.
  const otherDeduction = marketOtherDeduction({
    totalBill: n(totalBill),
    commission,
    cutting,
    reserve: n(reserve),
    netBill,
  });

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
              required
              {...field("billNo", initial?.billNo ?? "")}
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
        {/* Typed, not scrolled. A list of every open trip sorts by BUYING
            DAY, so a note raised today against an old purchase lands near the
            bottom and the merchant who entered it two minutes ago cannot find
            it. Typing 88 finds DN-00088. */}
        <TripPicker
          trips={trips}
          value={tripId}
          onChange={(id) => {
            setTripId(id);
            // Choosing a trip lays out its remaining load. Only on an actual
            // change, so re-opening a saved bill keeps the rows it was saved
            // with — this never fires on mount.
            fillFromTrip(trips.find((t) => t.id === id));
          }}
        />
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
                {...field("place", initial?.place ?? "")}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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
              <label htmlFor="cuttingRate" className={labelCls}>
                Cutting %
              </label>
              <input
                id="cuttingRate"
                name="cuttingRate"
                inputMode="decimal"
                value={cuttingRate}
                onChange={(e) => setCuttingRate(e.target.value)}
                className={inputCls + " num text-right"}
                placeholder="0"
              />
              <p className="text-muted text-[12px] mt-1">
                {n(cuttingRate) > 0 && n(totalBill) > 0
                  ? `${cuttingRate}% = ${fmtMoney(cutting)}`
                  : "Withheld, like reserve. Collected later."}
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
            {cutting > 0 && <Row label="Less cutting" value={-cutting} />}
            <Row label="Less reserve" value={-n(reserve)} />
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
                Commission, cutting, reserve and the net come to more than the
                total bill. Check the figures — labour / other cannot be
                negative, and the bill will not save while it is.
              </p>
            )}
            {rentDeducted > 0 && (
              <>
                <div className="flex justify-between border-t border-line mt-1 pt-1">
                  <span className="text-muted">
                    Less receipt — paid your driver{" "}
                    <span className="text-[11px]">(from the rent below)</span>
                  </span>
                  <span className="num">{fmtMoney(rentDeducted)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>This market still owes</span>
                  <span className="num">
                    {fmtMoney(netBill - rentDeducted)}
                  </span>
                </div>
                <p className="text-muted text-[12px] mt-2">
                  The bill is the full {fmtMoney(netBill)} and that is the
                  revenue. The {fmtMoney(rentDeducted)} they handed the driver
                  is a receipt against it, not a smaller bill — so what you
                  billed and what they have paid stay separate figures. The rent
                  itself is expensed once, at its full {fmtMoney(rentTotal)}, to
                  the trip&rsquo;s buying day.
                </p>
              </>
            )}
          </div>
        </>
      )}

      {/* ---- Fish Mill header ---- */}
      {type === "FISH_MILL" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label htmlFor="placeOfLoading" className={labelCls}>
              Place of Loading
            </label>
            <input id="placeOfLoading" {...field("placeOfLoading", initial?.placeOfLoading ?? "")} className={inputCls} />
          </div>
        </div>
      )}

      {/* ---- Factory ---- */}
      {type === "FACTORY" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          {/* The free-text "Return" has gone. A factory's return is a WEIGHT —
              it accepts every box and hands some kilos back — so it belongs in
              the weighing block below, where it is subtracted to reach the net
              the factory actually paid on. Typed as a note it was a remark
              beside the arithmetic instead of part of it, and the clerk had to
              enter the same figure again as "water less" to make the net come
              out right. */}
        </div>
      )}

      {weighed && (
        <div className="border border-line-strong bg-surface px-4 py-3">
          <div
            className={
              "grid grid-cols-1 gap-4 " +
              // A mill states two readings, then water, then the net: four
              // figures. A factory states one weight and its return.
              (twoWeighings ? "sm:grid-cols-2 md:grid-cols-4" : "sm:grid-cols-3")
            }
          >
            {twoWeighings ? (
              <>
                <div>
                  <label htmlFor="weightFirst" className={labelCls}>
                    1st Weight
                  </label>
                  <input
                    id="weightFirst"
                    name="weightFirst"
                    inputMode="decimal"
                    value={weightFirst}
                    onChange={(e) => setWeightFirst(e.target.value)}
                    className={inputCls + " num text-right"}
                  />
                  <p className="text-muted text-[12px] mt-1">
                    The lots and the truck.
                  </p>
                </div>
                <div>
                  <label htmlFor="weightSecond" className={labelCls}>
                    2nd Weight
                  </label>
                  <input
                    id="weightSecond"
                    name="weightSecond"
                    inputMode="decimal"
                    value={weightSecond}
                    onChange={(e) => setWeightSecond(e.target.value)}
                    className={inputCls + " num text-right"}
                  />
                  <p className="text-muted text-[12px] mt-1">
                    {totalWeight > 0
                      ? `The load is the difference: ${fmtKg(totalWeight)}.`
                      : "Just the lots."}
                  </p>
                </div>
              </>
            ) : (
              <div>
                <span className={labelCls}>Total Weight</span>
                {/* DERIVED on a factory bill: the return plus the net. The
                    factory states what it took and what it sent back; the total
                    is the two added, and a third field the clerk could type is
                    a third figure free to disagree with them. */}
                <p className="text-[15px] font-semibold num text-right py-2">
                  {totalWeight ? fmtKg(totalWeight) : "—"}
                </p>
                <p className="text-muted text-[12px] mt-1">
                  Return plus net — what arrived.
                </p>
                <input type="hidden" name="weight" value={totalWeight || ""} />
              </div>
            )}
            <div>
              {/* One column, two names, because the two trades take weight off
                  for different reasons and the bill has to say which.
                  
                  A fish mill deducts for the water and ice the load carried. A
                  factory accepts every box and hands back the fish it will not
                  take, by weight. Same subtraction, same net — but a factory
                  bill reading "water less 250" describes something that never
                  happened. */}
              <label htmlFor="waterLess" className={labelCls}>
                {type === "FACTORY" ? "Return" : "Water Less"}
              </label>
              <input
                id="waterLess"
                name="waterLess"
                inputMode="decimal"
                value={waterLess}
                onChange={(e) => setWaterLess(e.target.value)}
                className={inputCls + " num text-right"}
              />
              <p className="text-muted text-[12px] mt-1">
                {type === "FACTORY"
                  ? "Kilos they handed back. Taken off to reach what they paid on."
                  : "What they took off for water and ice."}
              </p>
            </div>
            <div>
              {factoryNetTyped ? (
                <>
                  <label htmlFor="netWeight" className={labelCls}>
                    Net Weight
                  </label>
                  <input
                    id="netWeight"
                    name="netWeight"
                    inputMode="decimal"
                    value={netWeightTyped}
                    onChange={(e) => setNetWeightTyped(e.target.value)}
                    className={inputCls + " num text-right"}
                  />
                </>
              ) : (
                <>
                  <span className={labelCls}>Net Weight</span>
                  {/* Derived, never typed. Three figures a clerk can enter
                      independently are three figures that can disagree. */}
                  <p className="text-[15px] font-semibold num text-right py-2">
                    {netWeight ? fmtKg(netWeight) : "—"}
                  </p>
                </>
              )}
              <p className="text-muted text-[12px] mt-1">
                {type === "FACTORY"
                  ? "What they accepted and paid on."
                  : "Total less water. What they paid on."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3 pt-3 border-t border-line">
            <div>
              <label htmlFor="totalBox" className={labelCls}>
                Total Box
              </label>
              <input
                id="totalBox"
                name="totalBox"
                inputMode="numeric"
                value={totalBox}
                onChange={(e) => setTotalBox(e.target.value)}
                className={inputCls + " num text-right"}
              />
              <p className="text-muted text-[12px] mt-1">
                {trip
                  ? "From the trip — what it still has unbilled."
                  : "The boxes this bill unloaded."}
              </p>
            </div>
            <div>
              <span className={labelCls}>Average Kg / Box</span>
              {/* The figure every Items row takes its weight from. The mill
                  weighs the lot on arrival; nobody weighs a single box. */}
              <p className="text-[15px] font-semibold num text-right py-2">
                {avgKgPerBox ? avgKgPerBox.toFixed(3) : "—"}
              </p>
              <p className="text-muted text-[12px] mt-1">
                Net weight ÷ total box. Each row&rsquo;s kilos come from this.
              </p>
            </div>
          </div>

          {boxesOff && (
            <p className="text-debit text-[12px] mt-3 pt-2 border-t border-line font-semibold">
              The items come to {boxTotal} box
              {boxTotal === 1 ? "" : "es"}, but this bill unloaded{" "}
              {n(totalBox)}. They have to agree before the weights mean
              anything.
            </p>
          )}
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
          <div className="items-scroll border border-line-strong bg-surface">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="items-head text-muted text-[12px] uppercase tracking-wide">
                  <th className="text-left font-semibold px-2 py-2 w-28">Pack</th>
                  <th className="text-right font-semibold px-2 py-2 w-16">Box</th>
                  <th className="text-left font-semibold px-3 py-2">Particular</th>
                  {/* Kgs on every channel. A market row's weight comes from
                      the delivery note, which recorded what one box weighed
                      when the truck was loaded — so it is not asked for twice.

                      No rate and no amount on a market bill: its money is the
                      net it paid, and a per-row price beside that invites
                      adding the rows up and asking why the two disagree. */}
                  <th className="text-right font-semibold px-2 py-2 w-24">Kgs</th>
                  {type !== "MARKET" && (
                    <th className="text-right font-semibold px-2 py-2 w-24">Rate/kg</th>
                  )}
                  {type !== "MARKET" && (
                    <th className="text-right font-semibold px-3 py-2 w-28">Amount</th>
                  )}
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const rowTotal = rowAmount(l);
                  return (
                    <tr key={i} className="border-t border-line">
                      <td className="px-1 py-1">
                        <select
                          name="pack"
                          value={l.pack}
                          onChange={(e) =>
                            setLine(i, {
                              pack: e.target.value as PackType,
                              // Loose fish never went into a crate, so a count
                              // left from the previous choice would be crates
                              // that do not exist.
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
                      <td className="px-1 py-1">
                        {/* readOnly, never a <span> — the same trap the Kgs
                            cell fell into. Rows travel as repeated `box` fields
                            paired up BY POSITION, so a row that sends nothing
                            shifts every row after it, and a bill mixing a loose
                            row with boxed ones would give one row's boxes to
                            another. The server zeroes a loose row's boxes
                            anyway; what matters is that something is sent. */}
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
                      <td className="px-2 py-1">
                        <input name="particular" value={l.particular} onChange={(e) => setLine(i, { particular: e.target.value })} className={inputCls} placeholder="e.g. Prawn" />
                      </td>
                      {/* What one box weighed, carried from the delivery note
                          rather than asked for again: it was recorded when the
                          truck was loaded, and the market's bill does not
                          restate it. Hidden but SUBMITTED — the server works
                          each row's kilos out from it. */}
                      {type === "MARKET" && (
                        <input
                          type="hidden"
                          name="kgPerBox"
                          value={l.pack === "LOOSE" ? "" : l.kgPerBox}
                        />
                      )}
                      <td className="px-1 py-1">
                        {weighed && l.pack !== "LOOSE" ? (
                            // Derived: the average off the weighing slip times
                            // this row's boxes. The mill weighed the lot and
                            // never weighed a box, so this is not typed.
                            //
                            // readOnly, NOT a <span> and not disabled. It has to
                            // remain a submitting field: the rows travel as
                            // repeated `qtyKg` inputs paired up by position, so
                            // a row that sends nothing shifts every row after
                            // it. A bill of two boxed rows sent no weights at
                            // all and was refused; a bill mixing Loose with
                            // boxed rows would have been worse, quietly giving
                            // the loose row's weight to somebody else.
                            //
                            // The server derives these again from the slip
                            // regardless, so what is sent here is a starting
                            // value and never the figure that is stored.
                            <input
                              name="qtyKg"
                              readOnly
                              tabIndex={-1}
                              value={rowKg(l) ? rowKg(l).toFixed(3) : ""}
                              className={cell + " text-muted bg-background"}
                            />
                        ) : type === "MARKET" && l.pack !== "LOOSE" ? (
                          // Derived: boxes times what one weighs. Same rule and
                          // same reason as a weighed bill's rows — a total the
                          // clerk could type independently is a total free to
                          // disagree with the two figures beside it.
                          <input
                            name="qtyKg"
                            readOnly
                            tabIndex={-1}
                            value={rowKg(l) ? rowKg(l).toFixed(3) : ""}
                            className={cell + " text-muted bg-background"}
                          />
                        ) : (
                          <input name="qtyKg" inputMode="decimal" value={l.qtyKg} onChange={(e) => setLine(i, { qtyKg: e.target.value })} className={cell} />
                        )}
                      </td>
                      {type !== "MARKET" && (
                        <td className="px-1 py-1">
                          <input name="ratePerKg" inputMode="decimal" value={l.ratePerKg} onChange={(e) => setLine(i, { ratePerKg: e.target.value })} className={cell} />
                        </td>
                      )}
                      {type !== "MARKET" && (
                        <td className="px-3 py-1 num text-right text-muted">{fmtMoney(rowTotal)}</td>
                      )}
                      <td className="px-1 py-1 text-center whitespace-nowrap">
                        <DuplicateRow
                          row={i + 1}
                          onDuplicate={() =>
                            setLines((ls) => duplicateAt(ls, i, BLANK_LINE))
                          }
                        />
                        {lines.length > 1 && (
                          <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-debit text-lg leading-none px-1" aria-label={`Remove row ${i + 1}`}>
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
                  <td />
                  <td className="px-2 py-2 num text-right">{boxTotal || ""}</td>
                  <td className="px-3 py-2 text-right">Total</td>
                  <td className="px-2 py-2 num text-right">
                    {kgTotal ? fmtKg(kgTotal) : ""}
                  </td>
                  {type !== "MARKET" && <td />}
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
        vehicles={vehicles}
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
          {...field("notes", initial?.notes ?? "")}
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
