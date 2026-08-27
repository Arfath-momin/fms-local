"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { SaleType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { getActiveScope, requireSubmittedScope } from "@/lib/centre";
import {
  postLedgerEntries,
  removeLedgerEntries,
  type PostLedgerArgs,
} from "@/lib/ledger";
import { findOrCreateParty } from "@/lib/party-db";
import { nextDocumentNo, saleSeriesPrefix } from "@/lib/document-series";
import { refreshTripStatus } from "@/lib/trip";
import {
  SALE_TYPES,
  SALE_TYPE_LABELS,
  SALE_BUYER_TYPE,
  SALE_TYPE_ALLOWS_CARE_OF,
  commissionAmount,
  MAX_COMMISSION_RATE,
} from "@/lib/sale";
import { resolveReviews } from "@/lib/review-db";
import {
  linkStagedAttachment,
  replaceStagedAttachment,
  stageAttachmentFile,
  unlinkAttachments,
  validateImageFile,
} from "@/lib/attachments";

export type SaleFormState = { error: string } | null;

const DECIMAL2 = /^\d+(\.\d{1,2})?$/;
const DECIMAL3 = /^\d+(\.\d{1,3})?$/;
const INT = /^\d+$/;
const ZERO = new Prisma.Decimal(0);

const clean = (v: FormDataEntryValue | null) =>
  String(v ?? "").trim().replace(/\s+/g, " ");

type ParsedLine = {
  particular: string;
  box: number | null;
  qtyKg: Prisma.Decimal;
  ratePerKg: Prisma.Decimal;
  count: number | null;
  total: Prisma.Decimal;
};

type Parsed = {
  type: SaleType;
  billNo: string;
  /** The buying day this fish came from — drives the ledger and every report. */
  date: Date;
  /** When the sale actually happened. Record only; posts to nothing. */
  saleDate: Date;
  buyerName: string;
  careOfName: string | null;
  amount: Prisma.Decimal; // recognised sale + posted to ledger
  // type-specific
  place: string | null;
  totalBill: Prisma.Decimal | null;
  commission: Prisma.Decimal | null;
  /** The percentage `commission` was struck at — 2.5 means 2.5%. */
  commissionRate: Prisma.Decimal | null;
  /** Withheld from a Market seller. Never netted against `amount`. */
  reserve: Prisma.Decimal | null;
  /** Labour and sundry deductions on a market bill. */
  otherDeduction: Prisma.Decimal | null;
  /** The trip this bill came off. Required for MARKET/FACTORY/FISH_MILL. */
  deliveryNoteId: string | null;
  /** This bill carried the trip's rent — the last market stop. */
  /**
   * The TRIP's whole rent, as the driver reported it here. Written back to the
   * trip, because rent is a property of the trip (invariant 2) — it is merely
   * not KNOWN until this bill.
   */
  /** What this market actually handed the driver: total − advance. Derived. */
  rentDeducted: Prisma.Decimal | null;
  weight: Prisma.Decimal | null;
  netWeight: Prisma.Decimal | null;
  vehicleNo: string | null;
  placeOfLoading: string | null;
  returnNote: string | null;
  /** Free-form remark, on every sale type. */
  notes: string | null;
  lines: ParsedLine[];
  file: unknown;
};

function parseMoney(raw: string): Prisma.Decimal | null {
  if (!DECIMAL2.test(raw)) return null;
  return new Prisma.Decimal(raw);
}

/** Fish Mill / Local line rows share a shape; box & count are Fish-Mill only. */
function parseLines(
  formData: FormData,
  withBoxCount: boolean,
  /**
   * MARKET lines carry boxes and nothing else. The money on a market bill is
   * the net the market paid, not a rate times a weight, so demanding a weight
   * would reject every market bill for a figure that has no meaning on one.
   */
  boxesOnly = false
): { error: string } | { lines: ParsedLine[] } {
  const particulars = formData.getAll("particular").map(String);
  const qtys = formData.getAll("qtyKg").map(String);
  const rates = formData.getAll("ratePerKg").map(String);
  const boxes = formData.getAll("box").map(String);
  const counts = formData.getAll("count").map(String);

  const lines: ParsedLine[] = [];
  for (let i = 0; i < particulars.length; i++) {
    const p = particulars[i].trim().replace(/\s+/g, " ");
    const qtyRaw = (qtys[i] ?? "").trim();
    const rateRaw = (rates[i] ?? "").trim();
    const boxRaw = (boxes[i] ?? "").trim();
    const countRaw = (counts[i] ?? "").trim();

    if (!p && !qtyRaw && !rateRaw && !boxRaw && !countRaw) continue;
    if (!p) return { error: "Every line needs a particular." };
    if (boxesOnly) {
      if (!INT.test(boxRaw) || Number(boxRaw) <= 0)
        return { error: `Boxes for “${p}” must be a positive whole number.` };
    } else if (!DECIMAL3.test(qtyRaw) || Number(qtyRaw) <= 0) {
      return { error: `Qty for “${p}” must be a positive number.` };
    }
    // Rate may be blank on a MARKET line: a market bill's money is the net the
    // market paid, not a rate × weight. The line is there to record what went
    // to whom, in boxes.
    if (rateRaw && !DECIMAL2.test(rateRaw))
      return { error: `Rate for “${p}” must be a number.` };

    let box: number | null = null;
    let count: number | null = null;
    if (withBoxCount) {
      if (boxRaw) {
        if (!INT.test(boxRaw)) return { error: `Box for “${p}” must be a whole number.` };
        box = Number(boxRaw);
      }
      if (countRaw) {
        if (!INT.test(countRaw)) return { error: `Count for “${p}” must be a whole number.` };
        count = Number(countRaw);
      }
    }

    const qtyKg = qtyRaw ? new Prisma.Decimal(qtyRaw) : new Prisma.Decimal(0);
    // Blank rate is zero — see the note above; a market line carries boxes,
    // not a price per kilo.
    const ratePerKg = rateRaw ? new Prisma.Decimal(rateRaw) : new Prisma.Decimal(0);
    // Rate is per kilo, so it applies to the weight actually sold — box × kgs
    // on a Fish Mill row, where kgs is the weight of one box. Charging the
    // per-box weight would bill ten boxes at the price of one.
    const totalKg = box && box > 0 ? qtyKg.mul(box) : qtyKg;
    lines.push({
      particular: p,
      box,
      qtyKg,
      ratePerKg,
      count,
      total: totalKg.mul(ratePerKg),
    });
  }
  return { lines };
}

// Async: where a trip is named, it has to be read to validate the bill against
// its date and its channel.
async function parse(
  formData: FormData,
  scope: { companyId: string; centreId: string }
): Promise<{ error: string } | { data: Parsed }> {
  const type = String(formData.get("type") ?? "") as SaleType;
  if (!SALE_TYPES.includes(type)) return { error: "Choose a sale type." };

  const billNo = clean(formData.get("billNo"));
  const dateRaw = String(formData.get("date") ?? "");
  const saleDateRaw = String(formData.get("saleDate") ?? "");
  const buyerName = clean(formData.get("buyerName"));
  const file = formData.get("bill");

  // LOCAL is exempt: its number is issued on save, not typed.
  if (!billNo && type !== "LOCAL")
    return { error: "Enter the bill number." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw))
    return { error: "Pick the purchase date this sale came from." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDateRaw))
    return { error: "Pick the date the sale was made." };
  // Fish cannot be sold before it was bought. Catches the commonest slip —
  // typing the sale's own date into the purchase field and vice versa.
  if (saleDateRaw < dateRaw)
    return {
      error:
        "The sale date is before the purchase date. Check which way round they go.",
    };
  if (!buyerName)
    return {
      error:
        type === "MARKET" ? "Enter the seller name." : "Enter the party name.",
    };

  const badFile = validateImageFile(file);
  if (badFile) return { error: badFile };

  // CareOf only on Fish Mill / Factory.
  let careOfName: string | null = null;
  if (SALE_TYPE_ALLOWS_CARE_OF[type]) {
    const c = clean(formData.get("careOfName"));
    careOfName = c || null;
  }

  const base = {
    type,
    billNo,
    date: new Date(dateRaw),
    saleDate: new Date(saleDateRaw),
    buyerName,
    careOfName,
    place: null as string | null,
    totalBill: null as Prisma.Decimal | null,
    commission: null as Prisma.Decimal | null,
    commissionRate: null as Prisma.Decimal | null,
    reserve: null as Prisma.Decimal | null,
    otherDeduction: null as Prisma.Decimal | null,
    deliveryNoteId: null as string | null,
    rentDeducted: null as Prisma.Decimal | null,
    weight: null as Prisma.Decimal | null,
    netWeight: null as Prisma.Decimal | null,
    vehicleNo: null as string | null,
    placeOfLoading: null as string | null,
    returnNote: null as string | null,
    notes: null as string | null,
    lines: [] as ParsedLine[],
    file,
  };

  let amount: Prisma.Decimal;

  if (type === "MARKET") {
    const totalBill = parseMoney(clean(formData.get("totalBill")));
    if (!totalBill || totalBill.lte(0))
      return { error: "Total Bill must be a positive number." };

    // The rate is per-bill. Blank means no commission on this sale, which is a
    // real case — not every market bill carries one — so it is allowed rather
    // than defaulted, and 0 stores nothing rather than a zero entry.
    const rateRaw = clean(formData.get("commissionRate"));
    let commissionRate: Prisma.Decimal | null = null;
    if (rateRaw) {
      const parsed = parseMoney(rateRaw);
      if (!parsed || parsed.lt(0) || parsed.gt(MAX_COMMISSION_RATE))
        return {
          error: `Commission rate must be between 0 and ${MAX_COMMISSION_RATE}%.`,
        };
      commissionRate = parsed;
    }
    // Computed through the same helper the form previews with, so the figure
    // the clerk approved and the figure stored are never two calculations.
    const commission =
      commissionRate && commissionRate.gt(0)
        ? new Prisma.Decimal(
            commissionAmount(totalBill.toNumber(), commissionRate.toNumber())
          ).toDecimalPlaces(2)
        : null;

    const reserve = parseMoney(clean(formData.get("reserve")));
    if (reserve && reserve.lt(0)) return { error: "Reserve cannot be negative." };

    // Rent deducted, TYPED, straight off the market's paper — one more
    // deduction line beside commission and labour, which is exactly how it
    // appears on the bill the merchant is copying from.
    //
    // It used to be derived: tick "last stop", type the trip's whole rent, and
    // the figure came out as total less the advance. That asked the clerk to
    // know the truck's whole route before they could enter a bill, and had no
    // answer at all when one journey ended in a factory bill for the load and a
    // market bill for the returns. The cost itself is a Vehicle Rent expense
    // voucher now; this number only grosses the day's revenue back up.
    const rentDeducted = parseMoney(clean(formData.get("rentDeducted")));
    if (rentDeducted && rentDeducted.lt(0))
      return { error: "Rent deducted cannot be negative." };

    // Net Bill is TYPED, from the paper the market handed over — it is the
    // figure they actually paid. "Labour / other" is then the balancing item:
    // the market lists two or three sundry charges nobody itemises, and what
    // is left after the named deductions is exactly what they came to.
    const netBill = parseMoney(clean(formData.get("netBill")));
    if (!netBill || netBill.lte(0))
      return { error: "Net Bill must be a positive number." };
    if (netBill.gt(totalBill))
      return {
        error:
          `Net Bill (${netBill.toFixed(2)}) cannot be more than Total Bill ` +
          `(${totalBill.toFixed(2)}).`,
      };

    // Market bills are itemised in BOXES — this is what the trip reconciles
    // against the boxes it dispatched, and how "which market took how much of
    // the load" is answered at all. The money still comes from the net below;
    // the lines are the box record, not the arithmetic.
    const marketLines = parseLines(formData, true, true);
    if ("error" in marketLines) return { error: marketLines.error };
    base.lines = marketLines.lines;

    base.place = clean(formData.get("place")) || null;
    base.totalBill = totalBill;
    base.commissionRate = commissionRate;
    base.commission = commission;
    base.reserve = reserve && reserve.gt(0) ? reserve : null;
    base.rentDeducted = rentDeducted && rentDeducted.gt(0) ? rentDeducted : null;
    // Net Bill is what the seller owes us for the fish. Commission, labour and
    // reserve stay netted inside it and are never posted separately; only the
    // rent is grossed back up at report time (see saleRevenue in lib/sale).
    amount = netBill;
  } else if (type === "FACTORY") {
    base.vehicleNo = clean(formData.get("vehicleNo")) || null;
    base.returnNote = clean(formData.get("returnNote")) || null;

    // Factory bills are itemised now, the same shape as a fish mill bill: the
    // factory reweighs on arrival and pays for what it accepts, and without
    // rows there was no record of how many BOXES that was — so a factory trip
    // could never be reconciled by box the way a market trip is.
    const parsedLines = parseLines(formData, true);
    if ("error" in parsedLines) return { error: parsedLines.error };

    if (parsedLines.lines.length > 0) {
      base.lines = parsedLines.lines;
      amount = parsedLines.lines.reduce((a, l) => a.add(l.total), ZERO);
    } else {
      // A bill entered before itemisation existed keeps its single figure.
      // Re-pricing one to zero because it has no rows would quietly rewrite a
      // sale the merchant never touched, so the old field is still accepted —
      // but only when there is genuinely nothing to itemise.
      const billAmount = parseMoney(clean(formData.get("amount")));
      if (!billAmount || billAmount.lte(0))
        return { error: "Add at least one line item." };
      amount = billAmount;
    }
  } else if (type === "FISH_MILL") {
    const parsedLines = parseLines(formData, true);
    if ("error" in parsedLines) return { error: parsedLines.error };
    if (parsedLines.lines.length === 0) return { error: "Add at least one line item." };
    base.lines = parsedLines.lines;
    base.weight = parseMoney(clean(formData.get("weight"))) ?? null;
    base.netWeight = parseMoney(clean(formData.get("netWeight"))) ?? null;
    base.vehicleNo = clean(formData.get("vehicleNo")) || null;
    base.placeOfLoading = clean(formData.get("placeOfLoading")) || null;
    amount = parsedLines.lines.reduce((a, l) => a.add(l.total), ZERO);
  } else {
    // LOCAL
    const parsedLines = parseLines(formData, false);
    if ("error" in parsedLines) return { error: parsedLines.error };
    if (parsedLines.lines.length === 0) return { error: "Add at least one line item." };
    base.lines = parsedLines.lines;
    amount = parsedLines.lines.reduce((a, l) => a.add(l.total), ZERO);
  }

  // Deductions are MARKET-only (spec §4). Factory, fish mill and local buyers
  // pay the bill in full — there is no commission to charge, nothing withheld,
  // and BFM pays those drivers itself, so no rent comes off their bills.
  //
  // Checked here rather than trusted from the form, which merely hides the
  // fields. A submitted deduction on one of those channels is either a
  // tampered form or a bug, and silently ignoring it would understate what the
  // buyer owes.
  if (type !== "MARKET") {
    const stray = (
      ["commissionRate", "otherDeduction", "reserve", "rentDeducted"] as const
    ).filter((f) => {
      const v = parseMoney(clean(formData.get(f)));
      return v !== null && v.gt(0);
    });
    if (clean(formData.get("carriesRent")) === "on") stray.push("carriesRent" as never);
    if (stray.length > 0)
      return {
        error:
          `A ${SALE_TYPE_LABELS[type].toLowerCase()} bill is paid in full — ` +
          `it carries no ${stray.join(", ")}.`,
      };
  }

  // Every sale type carries a remark. Read once here rather than in each
  // branch, because it is the one field that means the same thing on all four.
  base.notes = clean(formData.get("notes")) || null;

  // --- the trip this bill came off (spec §4) ------------------------------
  //
  // LOCAL is the exception: a local buyer collects, so there is no trip.
  // OPTIONAL on every channel now. It was required on market, factory and fish
  // mill so that the rent could be found — and the rent is not here any more.
  // What the link still buys is the box statement: name a trip and this bill's
  // boxes tally against the ones that went out. A bill that names no trip is a
  // perfectly ordinary bill, and refusing to save one was refusing to record a
  // sale over a piece of bookkeeping the merchant may not need that day.
  const deliveryNoteId = clean(formData.get("deliveryNoteId")) || null;

  if (deliveryNoteId) {
    const trip = await prisma.deliveryNote.findFirst({
      where: { id: deliveryNoteId, ...scope },
      select: {
        id: true,
        billNo: true,
        date: true,
        channel: true,
        rentAmount: true,
        advancePaid: true,
      },
    });
    if (!trip)
      return { error: "That trip does not belong to this company and centre." };

    // The channel a truck went out as no longer restricts what may be billed
    // against it, because one journey routinely ends in more than one kind of
    // sale: the load goes to the factory, the factory rejects some of it, and
    // the returns are sold at a market or locally on the way home. Refusing a
    // market bill on a factory trip made that ordinary day unrecordable.
    //
    // The trip's channel stays on the note as what it was DISPATCHED as, which
    // is what the box statement and the note itself are about.

    // One trip, one buying day. The sale's date is the trip's, full stop —
    // a bill arriving three days later still belongs to the day the fish was
    // bought, and that day is recorded on the trip.
    if (trip.date.getTime() !== base.date.getTime())
      return {
        error:
          `Trip ${trip.billNo} is for ${trip.date.toISOString().slice(0, 10)}, ` +
          `but this bill is dated ${base.date.toISOString().slice(0, 10)}. ` +
          `A bill takes its buying day from its trip.`,
      };


    base.deliveryNoteId = trip.id;
  }

  // "Labour / other" is the BALANCING item on a market bill, derived last
  // because the rent it has to balance against is only known once the trip has
  // been read. The market lists two or three sundry charges nobody itemises;
  // what is left between the total, the named deductions and the net they
  // actually paid is exactly what those came to.
  if (type === "MARKET" && base.totalBill) {
    const named = (base.commission ?? ZERO)
      .add(base.reserve ?? ZERO)
      .add(base.rentDeducted ?? ZERO);
    const other = base.totalBill.sub(named).sub(amount);
    if (other.lt(0))
      return {
        error:
          `Commission, reserve, rent and the net bill come to ` +
          `${named.add(amount).toFixed(2)}, more than the Total Bill of ` +
          `${base.totalBill.toFixed(2)}. Check the figures.`,
      };
    base.otherDeduction = other.gt(0) ? other : null;
  }

  return { data: { ...base, amount } };
}

/**
 * Ledger effect of a sale: DEBIT the party who owes us — the buyer, or the
 * CareOf agent when routed via CareOf — for the full sale amount.
 *
 * Nothing is credited back here. Collection is a Receipt voucher against the
 * party, so the balance this leaves standing is the real amount outstanding
 * until one is entered.
 *
 * A Market sale additionally posts the two amounts withheld from that bill:
 * the house's commission, and the seller's reserve. Both become ledgers with
 * running balances rather than numbers printed once and forgotten.
 *
 * They are separate accounts on purpose. Commission is the house's income;
 * reserve is the seller's own money held back. Neither is netted against
 * `amount`, which stays what the seller owes for the fish.
 */
/**
 * The transporter a trip's truck belongs to — who the rent is owed to.
 *
 * Read from the trip rather than passed in, so the sale action never has to
 * carry a transporter around that only one branch uses.
 */
async function tripTransporterId(
  tx: Prisma.TransactionClient,
  deliveryNoteId: string | null
): Promise<string | null> {
  if (!deliveryNoteId) return null;
  const trip = await tx.deliveryNote.findUnique({
    where: { id: deliveryNoteId },
    select: { vehicle: { select: { transporterId: true } } },
  });
  return trip?.vehicle.transporterId ?? null;
}

async function postSaleLedger(
  tx: Prisma.TransactionClient,
  s: {
    companyId: string;
    centreId: string;
    ledgerPartyId: string;
    id: string;
    amount: Prisma.Decimal;
    commission: Prisma.Decimal | null;
    reserve: Prisma.Decimal | null;
    /** The trip's whole rent, reported on this bill. */
    /** What this market handed the driver: total − advance. */
    rentDeducted: Prisma.Decimal | null;
    /** The trip's transporter, resolved by the caller. Null off-trip. */
    transporterId: string | null;
    date: Date;
  }
) {
  const entries: PostLedgerArgs[] = [
    {
      companyId: s.companyId,
      centreId: s.centreId,
      partyId: s.ledgerPartyId,
      type: "DEBIT" as const,
      sourceType: "SALE" as const,
      sourceId: s.id,
      amount: s.amount,
      date: s.date,
    },
  ];

  // Commission and reserve post NOTHING, deliberately (spec §2, invariants 4
  // and 5).
  //
  // Both used to open a standing house account: commission was DEBITed as
  // income and reserve CREDITed as a pooled liability. Both were wrong. BFM
  // buys fish outright and owns it — it is not a commission agent. The market
  // charges BFM a commission and withholds a reserve, and both are already
  // netted inside the net bill this sale posts. Posting them again would
  // count the same rupee twice and invent income the business never earned.
  //
  // Reserve is not lost by going unposted: its balance is DERIVED per market
  // party as SUM(sales.reserve) − SUM(reserve collections), which is what
  // keeps it per-party instead of pooled into one meaningless figure.

  // Rent posts NOTHING here either, and that is a correction as much as a
  // simplification.
  //
  // A market bill used to credit the market party the rent it had deducted, on
  // the reasoning that they were not out of pocket. But the NET this sale
  // DEBITs is the figure off the market's own paper, and that net is ALREADY
  // after the rent deduction. Crediting it again subtracted the same rupee
  // twice, so every market party who paid their bill in full ended up looking
  // like a creditor. Traced on a real bill:
  //
  //   total 45,000 − commission 900 − reserve 1,500 − labour 500
  //                − rent 15,000  =  net 27,100
  //   DEBIT 27,100, CREDIT 15,000  →  balance 12,100
  //   they pay the 27,100 printed on the bill  →  balance −15,000  ✗
  //
  // With nothing posted, the market owes exactly the net they will pay, and
  // closes at zero. The rent itself is a Vehicle Rent expense voucher: it
  // credits the transporter what he is owed and debits him the advance and
  // whatever the market handed him, so he closes at zero too.
  //
  // `rentDeducted` still lives on the sale, as a deduction line off the market's
  // paper. It buys one thing and only one: revenue is the net PLUS it (see
  // saleRevenue), because that money did leave the business — through the
  // driver — and a day whose revenue omitted it would be charged a cost it was
  // never credited for.

  await postLedgerEntries(tx, entries);
}


/**
 * The number this sale will carry.
 *
 * A LOCAL sale is BFM's own document — a local buyer collects and there is no
 * bill to copy from — so the number is issued here. Market, factory and fish
 * mill all bill BFM with their own number, which stays typed: it is the
 * reference they will quote back when there is a query.
 */
async function resolveSaleBillNo(
  tx: Prisma.TransactionClient,
  companyId: string,
  d: { type: SaleType; billNo: string }
): Promise<string> {
  const prefix = saleSeriesPrefix(d.type);
  if (!prefix) return d.billNo;
  // An edit keeps the number already issued; only a new voucher takes one.
  return d.billNo || (await nextDocumentNo(tx, companyId, prefix));
}

function saleData(d: Parsed, buyerId: string, careOfId: string | null) {
  return {
    type: d.type,
    partyId: buyerId,
    careOfPartyId: careOfId,
    billNo: d.billNo,
    date: d.date,
    saleDate: d.saleDate,
    amount: d.amount,
    place: d.place,
    totalBill: d.totalBill,
    commission: d.commission,
    commissionRate: d.commissionRate,
    reserve: d.reserve,
    otherDeduction: d.otherDeduction,
    deliveryNoteId: d.deliveryNoteId,
    rentDeducted: d.rentDeducted,
    notes: d.notes,
    weight: d.weight,
    netWeight: d.netWeight,
    vehicleNo: d.vehicleNo,
    placeOfLoading: d.placeOfLoading,
    returnNote: d.returnNote,
    lines: {
      create: d.lines.map((l) => ({
        particular: l.particular,
        box: l.box,
        qtyKg: l.qtyKg,
        ratePerKg: l.ratePerKg,
        count: l.count,
        total: l.total,
      })),
    },
  };
}

/**
 * Turns the one database constraint a clerk can actually hit into a sentence
 * they can act on.
 *
 * `sales_one_rent_carrier_per_trip` only fires in the race the application
 * check cannot cover — two bills for the same trip saved in the same instant,
 * both seeing no existing rent carrier. Rare, but the raw Prisma text names an
 * index and a table and would leave the clerk with nothing to do.
 */
function saveError(e: unknown, fallback: string): string {
  const text = e instanceof Error ? e.message : "";
  if (text.includes("sales_one_rent_carrier_per_trip")) {
    return (
      "Another bill for this trip was saved at the same moment and has taken " +
      "the rent. Only the last stop carries it — reopen this bill, untick " +
      "“last stop”, and save again."
    );
  }
  return e instanceof Error ? e.message : fallback;
}

export async function createSale(
  _prev: SaleFormState,
  formData: FormData
): Promise<SaleFormState> {
  const session = await requireEntry();
  // Scope first: parse validates the trip against this company and centre, so
  // the scope has to be known before parsing rather than after.
  const scoped = await requireSubmittedScope(formData);
  if ("error" in scoped) return { error: scoped.error };
  const { company, centre } = scoped.scope;
  const parsed = await parse(formData, {
    companyId: company.id,
    centreId: centre.id,
  });
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  let saleId: string;
  try {
    // Staged before the transaction so a rejected image aborts the save
    // instead of leaving a sale with no bill against it.
    const staged = await stageAttachmentFile(d.file);
    saleId = await prisma.$transaction(async (tx) => {
      const buyerId = await findOrCreateParty(tx, d.buyerName, SALE_BUYER_TYPE[d.type]);
      const careOfId = d.careOfName
        ? await findOrCreateParty(tx, d.careOfName, "CARE_OF")
        : null;
      const sale = await tx.sale.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          ...saleData(d, buyerId, careOfId),
          // Issued inside the transaction for a LOCAL sale, so a failed save
          // rolls the number back rather than leaving a gap in the series.
          billNo: await resolveSaleBillNo(tx, company.id, d),
          createdById: session.userId,
        },
      });
      await postSaleLedger(tx, {
        companyId: company.id,
        centreId: centre.id,
        ledgerPartyId: careOfId ?? buyerId,
        id: sale.id,
        amount: d.amount,
        commission: d.commission,
        reserve: d.reserve,
        rentDeducted: d.rentDeducted,
        transporterId: await tripTransporterId(tx, d.deliveryNoteId),
        date: d.date,
      });
      // The trip moves DISPATCHED → PART_BILLED → CLOSED as its bills land.
      // Derived from the boxes actually billed, not set by hand — a status
      // somebody has to remember to change is one that goes stale.
      await refreshTripStatus(tx, d.deliveryNoteId);
      await linkStagedAttachment(tx, staged, {
        companyId: company.id,
        centreId: centre.id,
        linkedType: "SALE",
        linkedId: sale.id,
      });
      return sale.id;
    });
  } catch (e) {
    return { error: saveError(e, "Could not save sale.") };
  }

  revalidatePath("/vouchers/sales");
  revalidatePath("/ledgers", "layout");
  redirect(`/vouchers/sales/${saleId}`);
}

/**
 * Delete a sale outright.
 *
 * A Market sale posts to two ledgers — the buyer (or the CareOf agent) and the
 * the transporter's rent chain — and removeLedgerEntries repairs both, because it
 * collects the affected scopes from the entries themselves rather than from
 * the sale record. Ledger entries go before the row for the reason spelled out
 * on deletePurchase; the sale's lines cascade with it.
 */
export async function deleteSale(
  saleId: string,
  _prev: SaleFormState
): Promise<SaleFormState> {
  const session = await requireAdmin();

  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        // Scoped: an admin may only change or remove a voucher that belongs to
        // the company and centre they are currently working in.
        where: { id: saleId, companyId: company.id, centreId: centre.id },
        select: { id: true, deliveryNoteId: true },
      });
      if (!existing) throw new Error("Sale not found.");

      await removeLedgerEntries(tx, { sourceId: saleId });
      // If this was the bill that recorded the trip's rent, the rent goes with
      // it: the expense is cleared and the trip's total returns to unknown,
      // which is honest — nothing has reported the kilometres any more.
      await unlinkAttachments(tx, "SALE", saleId);
      // Removing the voucher answers any request against it. The request rows
      // themselves survive — they record that a correction was asked for.
      await resolveReviews(tx, "SALE", saleId, session.userId);
      await tx.sale.delete({ where: { id: saleId } });
      // After the delete, not before: the tally counts the trip's remaining
      // bills, and this one has to be gone before that reads correctly. A trip
      // whose only bill is removed goes back to DISPATCHED and reappears on
      // the open-trips list, which is exactly right — it is out again.
      await refreshTripStatus(tx, existing.deliveryNoteId);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not delete sale." };
  }

  revalidatePath("/vouchers/sales");
  revalidatePath("/ledgers", "layout");
  revalidatePath("/dashboard");
  redirect("/vouchers/sales");
}

export async function updateSale(
  saleId: string,
  _prev: SaleFormState,
  formData: FormData
): Promise<SaleFormState> {
  const session = await requireAdmin();
  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  const parsed = await parse(formData, {
    companyId: company.id,
    centreId: centre.id,
  });
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  try {
    const staged = await stageAttachmentFile(d.file);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        // Scoped: an admin may only change or remove a voucher that belongs to
        // the company and centre they are currently working in.
        where: { id: saleId, companyId: company.id, centreId: centre.id },
        select: {
          companyId: true,
          centreId: true,
          date: true,
          // An issued LOCAL number is kept rather than reissued on every edit.
          billNo: true,
          // Needed so an edit that moves the bill to another trip can refresh
          // the one it left as well as the one it joined.
          deliveryNoteId: true,
        },
      });
      if (!existing) throw new Error("Sale not found.");

      // Rebuilds the old ledger party's statement too, in case this edit
      // reassigns the buyer or routes the sale via a different CareOf agent.
      // RENT_BY_PARTY is in the list because a market bill can post it against
      // BOTH the market party and the transporter. Leaving those behind on an
      // edit would keep the transporter's rent looking settled by a figure the
      // bill no longer carries.
      await removeLedgerEntries(tx, {
        sourceId: saleId,
        sourceType: ["SALE", "PAYMENT", "RECEIPT", "RENT_BY_PARTY"],
      });
      await tx.saleLine.deleteMany({ where: { saleId } });

      const buyerId = await findOrCreateParty(tx, d.buyerName, SALE_BUYER_TYPE[d.type]);
      const careOfId = d.careOfName
        ? await findOrCreateParty(tx, d.careOfName, "CARE_OF")
        : null;
      await tx.sale.update({
        where: { id: saleId },
        data: {
          ...saleData(d, buyerId, careOfId),
          // An issued number is fixed. A market, factory or mill bill keeps
          // whatever the counterparty's paper says, which stays editable.
          billNo: await resolveSaleBillNo(tx, company.id, {
            type: d.type,
            billNo: d.billNo || existing.billNo,
          }),
          updatedById: session.userId,
          updatedAt: new Date(),
        },
      });
      await postSaleLedger(tx, {
        companyId: existing.companyId,
        centreId: existing.centreId,
        ledgerPartyId: careOfId ?? buyerId,
        id: saleId,
        amount: d.amount,
        commission: d.commission,
        reserve: d.reserve,
        rentDeducted: d.rentDeducted,
        transporterId: await tripTransporterId(tx, d.deliveryNoteId),
        date: d.date,
      });
      // Both trips, because an edit can move a bill from one to another: the
      // trip it left may fall back to PART_BILLED, and the one it joined may
      // now close.
      await refreshTripStatus(tx, existing.deliveryNoteId);
      await refreshTripStatus(tx, d.deliveryNoteId);
      // A newly chosen image replaces the old bill rather than piling up
      // beside it; leaving the field empty keeps whatever is attached.
      await replaceStagedAttachment(tx, staged, {
        companyId: existing.companyId,
        centreId: existing.centreId,
        linkedType: "SALE",
        linkedId: saleId,
      });
      // The edit *is* the answer to any review request against this sale, so a
      // successful save closes it. In the same transaction: a save that rolls
      // back leaves the request standing.
      await resolveReviews(tx, "SALE", saleId, session.userId);
    });
  } catch (e) {
    return { error: saveError(e, "Could not save sale.") };
  }

  revalidatePath("/vouchers/sales");
  revalidatePath("/ledgers", "layout");
  revalidatePath("/dashboard");
  redirect(`/vouchers/sales/${saleId}`);
}
