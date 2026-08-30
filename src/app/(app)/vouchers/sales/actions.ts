"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { PackType, SaleType } from "@/generated/prisma/enums";
import { PACK_TYPES } from "@/lib/pack";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { getActiveScope, requireSubmittedScope } from "@/lib/centre";
import {
  postLedgerEntries,
  removeLedgerEntries,
  type PostLedgerArgs,
} from "@/lib/ledger";
import { findOrCreateParty } from "@/lib/party-db";
import { expenseEntryAmount, expenseEntryVendor } from "@/lib/expense-entry";
import { nextDocumentNo, saleSeriesPrefix } from "@/lib/document-series";
import { refreshTripStatus } from "@/lib/trip";
import {
  SALE_TYPES,
  SALE_TYPE_LABELS,
  SALE_BUYER_TYPE,
  SALE_TYPE_ALLOWS_CARE_OF,
  commissionAmount,
  marketOtherDeduction,
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
  pack: PackType;
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
  cutting: Prisma.Decimal | null;
  cuttingRate: Prisma.Decimal | null;
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
  /** Costs entered on this bill, each becoming an expense voucher. */
  expenses: ParsedExpense[];
  weight: Prisma.Decimal | null;
  netWeight: Prisma.Decimal | null;
  waterLess: Prisma.Decimal | null;
  totalBox: number | null;
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

/**
 * Turn a bill's expense rows into real expense vouchers, inside its transaction.
 *
 * Replaced wholesale rather than diffed, the same discipline the rest of the
 * voucher actions use: an edit can add a row, change an amount or move a cost
 * to a different head, and rebuilding is the only version of that which cannot
 * leave a stale row behind. Their LEDGER entries go first, so the vendors whose
 * balances change are recomputed whether they gained a row or lost one.
 *
 * Dated to the TRIP'S buying day where there is a trip. That is the whole point
 * of entering them here: the ice and the rent belong to the day the fish was
 * bought, not to the day the market's bill happened to arrive.
 */
async function writeSaleExpenses(
  tx: Prisma.TransactionClient,
  e: {
    saleId: string;
    companyId: string;
    centreId: string;
    deliveryNoteId: string | null;
    /** The trip's buying day, or the bill's own date when it names no trip. */
    date: Date;
    rows: ParsedExpense[];
    userId: string;
  }
) {
  const existing = await tx.expense.findMany({
    where: { saleId: e.saleId },
    select: { id: true },
  });
  for (const x of existing) {
    await removeLedgerEntries(tx, { sourceId: x.id, sourceType: ["EXPENSE"] });
  }
  await tx.expense.deleteMany({ where: { saleId: e.saleId } });

  if (e.rows.length === 0) return;

  const rentId = (
    await tx.expenseCategory.findUnique({
      where: {
        companyId_code: { companyId: e.companyId, code: RENT_CATEGORY_CODE },
      },
      select: { id: true },
    })
  )?.id;

  for (const row of e.rows) {
    // The head has to belong to this company — the id came from the client.
    const category = await tx.expenseCategory.findFirst({
      where: { id: row.categoryId, companyId: e.companyId, archivedAt: null },
      select: { id: true, code: true, name: true },
    });
    if (!category) throw new Error("That expense head no longer exists.");

    // Vehicle rent is owed to the trip's TRANSPORTER, filled in here rather
    // than taken from the drawer: the trip is the only thing that can say who
    // that is, and a client-sent name is one more way for one man's account to
    // end up spelled two ways. The advance rides along for the record — it was
    // already posted on the delivery note and is deliberately NOT posted again.
    const isRent = rentId !== undefined && row.categoryId === rentId;
    const details: Record<string, string> = { ...row.details };
    // Rent's truck and owner were resolved in parse(), from the trip or the
    // vehicle master. Nothing to look up again here.
    const vendor = isRent
      ? details.transporter
      : expenseEntryVendor(
          { code: category.code, name: category.name, allowsLines: false },
          details
        );
    const partyId = vendor
      ? await findOrCreateParty(
          tx,
          vendor,
          isRent ? "TRANSPORTER" : "EXPENSE_VENDOR"
        )
      : null;

    const expense = await tx.expense.create({
      data: {
        companyId: e.companyId,
        centreId: e.centreId,
        categoryId: category.id,
        partyId,
        saleId: e.saleId,
        deliveryNoteId: e.deliveryNoteId,
        amount: row.amount,
        date: e.date,
        spentOn: null,
        // Everything the head asked for, so the voucher is finished here and
        // never has to be opened again under Vouchers → Expenses to complete it.
        details,
        lines: row.lines.length ? { create: row.lines } : undefined,
      },
      select: { id: true },
    });

    // Nothing is PAID here — the vendor is credited what he is owed, and
    // settling is a Payment voucher against him, as everywhere else.
    if (partyId) {
      await postLedgerEntries(tx, [
        {
          companyId: e.companyId,
          centreId: e.centreId,
          partyId,
          type: "CREDIT",
          sourceType: "EXPENSE",
          sourceId: expense.id,
          amount: row.amount,
          date: e.date,
        },
      ]);
    }
  }
}


/**
 * Give every Items row the weight the weighing slip implies.
 *
 * The buyer weighs the CONSIGNMENT on arrival — nobody weighs a single box — so
 * a per-row weight was a figure the paper never broke down and the clerk had to
 * apportion by hand. The average falls out of the slip (net ÷ total box) and
 * each row takes it times its own boxes.
 *
 * A LOOSE row keeps the weight that was typed: it never went into a box, so
 * there is no average that applies to it.
 *
 * The rows have to add up to the boxes the bill unloaded, or the average is
 * being spread over a count that does not match what was counted.
 */
function applyWeighingSlip(
  base: {
    lines: ParsedLine[];
    netWeight: Prisma.Decimal | null;
    totalBox: number | null;
  }
): { error: string } | null {
  const totalBox = base.totalBox ?? 0;
  if (totalBox <= 0) return null;

  const boxed = base.lines.reduce(
    (a, l) => a + (l.pack === "LOOSE" ? 0 : l.box ?? 0),
    0
  );
  if (boxed !== totalBox)
    return {
      error:
        `The items come to ${boxed} box${boxed === 1 ? "" : "es"}, but this ` +
        `bill unloaded ${totalBox}. They have to agree before the weights ` +
        `mean anything.`,
    };

  const avg = (base.netWeight ?? ZERO).div(totalBox);
  for (const l of base.lines) {
    if (l.pack === "LOOSE") continue;
    l.qtyKg = avg.mul(l.box ?? 0).toDecimalPlaces(3);
    l.total = l.qtyKg.mul(l.ratePerKg);
  }
  return null;
}

/** The category a trip's rent is filed under. */
const RENT_CATEGORY_CODE = "RENT";

/**
 * What the market handed the driver, off the rent rows on this bill.
 *
 * Read from the rent row's own "Paid to Driver by Market" field rather than
 * assumed to be the whole balance. A market usually settles what is left after
 * the advance, but not always — and inferring it as total − advance made a
 * part payment impossible to record, and silently claimed the driver had been
 * paid in full when he had not.
 */
function paidByMarketOn(rows: ParsedExpense[], rentCategoryId: string): Prisma.Decimal {
  return rows
    .filter((r) => r.categoryId === rentCategoryId)
    .reduce(
      (a, r) => a.add(new Prisma.Decimal(r.details.paidByMarket || 0)),
      ZERO
    );
}

/** The rent among a bill's expense rows, in rupees. */
function rentOnRows(
  rows: ParsedExpense[],
  rentCategoryId: string
): Prisma.Decimal {
  return rows
    .filter((r) => r.categoryId === rentCategoryId)
    .reduce((a, r) => a.add(r.amount), ZERO);
}

/**
 * The buyer's weighing slip: as loaded, after water and ice, and handed back.
 *
 * Recorded on fish mill and factory bills, where the buyer reweighs on arrival.
 * Deliberately NOT part of the money — the Items rows are what the buyer
 * actually took, and their weights and amounts are what the bill, the ledger
 * and the box statement all read. The form points out when net less return does
 * not come to the Items total; it does not refuse the bill over it, because a
 * paper that will not quite reconcile is still the paper that was handed over.
 */
function readWeighingSlip(
  formData: FormData,
  base: {
    weight: Prisma.Decimal | null;
    netWeight: Prisma.Decimal | null;
    waterLess: Prisma.Decimal | null;
    totalBox: number | null;
  }
): { error: string } | null {
  base.weight = parseMoney(clean(formData.get("weight"))) ?? null;
  base.waterLess = parseMoney(clean(formData.get("waterLess"))) ?? null;

  if (base.waterLess && base.weight && base.waterLess.gt(base.weight))
    return {
      error:
        `They cannot have taken off ${base.waterLess.toFixed(3)} kg for water ` +
        `from a load of ${base.weight.toFixed(3)} kg.`,
    };

  // Derived, never read from the form. Three figures a clerk can type
  // independently are three figures that can disagree, and the net is the one
  // the money hangs off.
  base.netWeight = base.weight
    ? base.weight.sub(base.waterLess ?? ZERO)
    : null;

  const boxRaw = clean(formData.get("totalBox"));
  if (boxRaw) {
    if (!INT.test(boxRaw))
      return { error: "Total box must be a whole number." };
    base.totalBox = Number(boxRaw);
  }
  return null;
}

/**
 * The truck a rent row belongs to, and who owns it — read from the database.
 *
 * Two ways in, and neither is typed:
 *
 *   the bill names a TRIP     the trip's own vehicle, owner and advance
 *   it does not               the vehicle picked out of the master
 *
 * Resolving it here rather than trusting what was posted is what stops
 * "KA20B5521" and "KA 20 B 5521" becoming two trucks with two ledgers, and it
 * is the only way the owner beside a number can be relied on at all.
 */
async function resolveRentVehicle(
  formData: FormData,
  details: Record<string, string>,
  scope: { companyId: string; centreId: string }
): Promise<{ error: string } | { details: Record<string, string> }> {
  const deliveryNoteId = clean(formData.get("deliveryNoteId")) || null;

  if (deliveryNoteId) {
    const trip = await prisma.deliveryNote.findFirst({
      where: { id: deliveryNoteId, ...scope },
      select: {
        advancePaid: true,
        vehicle: {
          select: { number: true, transporter: { select: { name: true } } },
        },
      },
    });
    if (!trip) return { error: "that trip does not belong here." };
    const advance = Number(trip.advancePaid ?? 0);
    return {
      details: {
        vehicleNo: trip.vehicle.number,
        transporter: trip.vehicle.transporter.name,
        ...(advance > 0 ? { advance: String(advance) } : {}),
      },
    };
  }

  if (details.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: details.vehicleId,
        companyId: scope.companyId,
        archivedAt: null,
      },
      select: { number: true, transporter: { select: { name: true } } },
    });
    if (!vehicle) return { error: "that vehicle no longer exists." };
    return {
      details: {
        vehicleNo: vehicle.number,
        transporter: vehicle.transporter.name,
      },
    };
  }

  return { error: "choose the vehicle, or the trip this bill came off." };
}

/** One cost entered on a bill, before it becomes an expense voucher. */
type ParsedExpense = {
  categoryId: string;
  details: Record<string, string>;
  amount: Prisma.Decimal;
  lines: { description: string; amount: Prisma.Decimal }[];
};

/**
 * The costs a bill reveals, entered on the bill itself.
 *
 * They arrive as JSON in one field rather than as repeated inputs, because the
 * shape differs per head — ice has five fields, canteen has none — and pairing
 * repeated names up by array index is the kind of thing that works until
 * somebody adds a category.
 *
 * The amount is RECOMPUTED here from the same function the drawer previews
 * with, never taken from what was posted: a total is money, and money the
 * client sends is a suggestion.
 */
async function parseExpenses(
  formData: FormData,
  categories: { id: string; code: string; name: string; allowsLines: boolean }[],
  scope: { companyId: string; centreId: string }
): Promise<{ error: string } | { expenses: ParsedExpense[] }> {
  const raw = String(formData.get("expenses") ?? "").trim();
  if (!raw || raw === "[]") return { expenses: [] };

  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return { error: "The expenses on this bill could not be read." };
  }
  if (!Array.isArray(rows))
    return { error: "The expenses on this bill could not be read." };

  const expenses: ParsedExpense[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as {
      categoryId?: unknown;
      details?: unknown;
      amount?: unknown;
      lines?: unknown;
    };
    const categoryId = typeof r.categoryId === "string" ? r.categoryId : "";
    // A row the clerk opened and never filled in is not an error — it is a row
    // they changed their mind about.
    if (!categoryId) continue;

    // The head has to be one of this company's, live. The id came from a client.
    const category = categories.find((c) => c.id === categoryId);
    if (!category)
      return { error: "That expense head no longer exists." };

    const details: Record<string, string> = {};
    if (typeof r.details === "object" && r.details !== null) {
      for (const [k, v] of Object.entries(r.details as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim())
          details[k] = v.trim().replace(/\s+/g, " ");
      }
    }

    const lines = Array.isArray(r.lines)
      ? (r.lines as unknown[]).flatMap((l) => {
          if (typeof l !== "object" || l === null) return [];
          const x = l as { description?: unknown; amount?: unknown };
          return [
            {
              description:
                typeof x.description === "string" ? x.description.trim() : "",
              amount: typeof x.amount === "string" ? x.amount.trim() : "",
            },
          ];
        })
      : [];

    // Vehicle rent's truck and its owner are NOT the client's to send. The
    // drawer only ever shows them — from the trip, or from the vehicle picked
    // out of the master — so they arrive missing, and the validation below was
    // rejecting a perfectly filled-in row for a "Vehicle No" the merchant had
    // no box to type into. They are resolved HERE, from the database, before
    // anything is validated: the row carries a trip or a vehicle id, and only
    // the database can say which truck that is and who owns it.
    if (category.code === RENT_CATEGORY_CODE) {
      const resolved = await resolveRentVehicle(formData, details, scope);
      if ("error" in resolved) return { error: `${category.name}: ${resolved.error}` };
      Object.assign(details, resolved.details);
    }

    const computed = expenseEntryAmount(
      category,
      details,
      typeof r.amount === "string" ? r.amount : "",
      lines
    );
    if ("error" in computed)
      return { error: `${category.name}: ${computed.error}` };

    expenses.push({
      categoryId: category.id,
      details,
      amount: new Prisma.Decimal(computed.amount),
      lines: lines
        .filter((l) => l.description && l.amount)
        .map((l) => ({
          description: l.description,
          amount: new Prisma.Decimal(l.amount),
        })),
    });
  }
  return { expenses };
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
  boxesOnly = false,
  /**
   * FISH_MILL and FACTORY. Their row weights are DERIVED from the weighing
   * slip — the average kg per box times this row's boxes — so demanding a
   * typed weight here rejects a bill for a figure the clerk is not the source
   * of, and which applyWeighingSlip is about to overwrite anyway.
   *
   * What those rows must have instead is BOXES, since the boxes are what the
   * average is spread over. A LOOSE row is the exception at both ends: it
   * carries no boxes and keeps the weight that was typed for it.
   */
  weighed = false
): { error: string } | { lines: ParsedLine[] } {
  const packs = formData.getAll("pack").map(String);
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
    const pack = PACK_TYPES.includes(packs[i] as PackType)
      ? (packs[i] as PackType)
      : "BOX";

    if (!p && !qtyRaw && !rateRaw && !boxRaw && !countRaw) continue;
    if (!p) return { error: "Every line needs a particular." };
    if (boxesOnly) {
      if (!INT.test(boxRaw) || Number(boxRaw) <= 0)
        return { error: `Boxes for “${p}” must be a positive whole number.` };
    } else if (weighed && pack !== "LOOSE") {
      // Boxes, not kilos. The weight arrives from the slip a moment later.
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

    // Loose fish never went into a crate, so it carries none however many the
    // form happens to have sent — and it must stay out of every box tally
    // rather than count as zero and appear to balance.
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
    // The weight typed IS the line's weight now — the whole lot on the scale,
    // not one box multiplied up. Nothing to derive; the per-box average is
    // shown from these two numbers rather than being the input to them.
    const totalKg = qtyKg;
    lines.push({
      pack,
      particular: p,
      box: pack === "LOOSE" ? null : box,
      qtyKg,
      ratePerKg,
      count,
      total: totalKg.mul(ratePerKg),
    });
  }
  return { lines };
}

// Async: where a trip is named, it has to be read to validate the bill's buying
// day against it, and to price the rent a market deducted.
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
    cutting: null as Prisma.Decimal | null,
    cuttingRate: null as Prisma.Decimal | null,
    otherDeduction: null as Prisma.Decimal | null,
    deliveryNoteId: null as string | null,
    rentDeducted: null as Prisma.Decimal | null,
    expenses: [] as ParsedExpense[],
    weight: null as Prisma.Decimal | null,
    netWeight: null as Prisma.Decimal | null,
    waterLess: null as Prisma.Decimal | null,
    totalBox: null as number | null,
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

    // Cutting — the market's second withholding, struck as a percentage of the
    // total the way commission is. Same shape as the commission rate above,
    // including that blank means none rather than zero.
    const cutRaw = clean(formData.get("cuttingRate"));
    let cuttingRate: Prisma.Decimal | null = null;
    if (cutRaw) {
      const parsed = parseMoney(cutRaw);
      if (!parsed || parsed.lt(0) || parsed.gt(MAX_COMMISSION_RATE))
        return {
          error: `Cutting rate must be between 0 and ${MAX_COMMISSION_RATE}%.`,
        };
      cuttingRate = parsed;
    }
    const cutting =
      cuttingRate && cuttingRate.gt(0)
        ? new Prisma.Decimal(
            commissionAmount(totalBill.toNumber(), cuttingRate.toNumber())
          ).toDecimalPlaces(2)
        : null;

    // Net Bill is TYPED, from the paper the market handed over. "Labour /
    // other" is then the balancing item: the market lists two or three sundry
    // charges nobody itemises, and what is left after the named deductions is
    // exactly what they came to.
    //
    // Rent is NOT among the named deductions any more. What the market handed
    // the driver settles part of this bill rather than shrinking it, so the net
    // typed here is the whole net and the rent comes off as a receipt.
    const netBill = parseMoney(clean(formData.get("netBill")));
    if (!netBill || netBill.lte(0))
      return { error: "Net Bill must be a positive number." };
    if (netBill.gt(totalBill))
      return {
        error:
          `Net Bill (${netBill.toFixed(2)}) cannot be more than Total Bill ` +
          `(${totalBill.toFixed(2)}).`,
      };

    // The balancing item, DERIVED and then stored.
    //
    // It was derived in the form and shown to the clerk, but never written —
    // so the column sat null on every bill entered through the app while the
    // screen displayed a figure. Storing it means the bill can be read back the
    // way it was approved.
    const other = new Prisma.Decimal(
      marketOtherDeduction({
        totalBill: totalBill.toNumber(),
        commission: commission?.toNumber() ?? 0,
        cutting: cutting?.toNumber() ?? 0,
        reserve: reserve?.toNumber() ?? 0,
        netBill: netBill.toNumber(),
      })
    ).toDecimalPlaces(2);
    if (other.lt(0))
      return {
        error:
          `Commission, cutting, reserve and the net bill come to ` +
          `${totalBill.sub(other).toFixed(2)}, which is more than the total ` +
          `bill (${totalBill.toFixed(2)}). Check the figures.`,
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
    base.cuttingRate = cuttingRate;
    base.cutting = cutting;
    base.otherDeduction = other.gt(0) ? other : null;
    // What the market owes us for the fish, in full. Commission, cutting,
    // reserve and labour stay netted inside it and are never posted separately.
    // Nothing is grossed back up at report time any more — this IS the revenue.
    amount = netBill;
  } else if (type === "FACTORY") {
    const slip = readWeighingSlip(formData, base);
    if (slip) return slip;
    base.returnNote = clean(formData.get("returnNote")) || null;

    // Factory bills are itemised now, the same shape as a fish mill bill: the
    // factory reweighs on arrival and pays for what it accepts, and without
    // rows there was no record of how many BOXES that was — so a factory trip
    // could never be reconciled by box the way a market trip is.
    const parsedLines = parseLines(formData, true, false, true);
    if ("error" in parsedLines) return { error: parsedLines.error };

    if (parsedLines.lines.length > 0) {
      base.lines = parsedLines.lines;
      const applied = applyWeighingSlip(base);
      if (applied) return applied;
      amount = base.lines.reduce((a, l) => a.add(l.total), ZERO);
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
    // The slip BEFORE the rows, the same order the factory branch uses.
    //
    // Read the other way round, a bill with no weighing slip failed on the
    // first row's weight — "Qty for Prawns must be a positive number" — when
    // the actual trouble was upstream: on a weighed bill the row weights are
    // derived from the slip, so a missing slip has no weights to give them.
    // Checking the slip first makes the complaint the true one.
    const slip = readWeighingSlip(formData, base);
    if (slip) return slip;
    const parsedLines = parseLines(formData, true, false, true);
    if ("error" in parsedLines) return { error: parsedLines.error };
    if (parsedLines.lines.length === 0) return { error: "Add at least one line item." };
    base.lines = parsedLines.lines;
    base.placeOfLoading = clean(formData.get("placeOfLoading")) || null;
    const applied = applyWeighingSlip(base);
    if (applied) return applied;
    amount = base.lines.reduce((a, l) => a.add(l.total), ZERO);
  } else {
    // LOCAL
    //
    // Boxes ARE kept. They were discarded here, from back when a local buyer
    // collected loose fish off the yard and there was no trip behind it. A
    // local bill can be filled from a trip now, and its boxes count against
    // what the truck carried — so the form showed the 40 boxes the trip had
    // left, and the server dropped every one of them on save.
    const parsedLines = parseLines(formData, true);
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
      [
        "commissionRate",
        "cuttingRate",
        "otherDeduction",
        "reserve",
        "rentDeducted",
      ] as const
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

  // The live heads, so a row can only name one this company actually has and
  // the amount is worked out from the head's own rule rather than trusted.
  const expenseCategories = await prisma.expenseCategory.findMany({
    where: { companyId: scope.companyId, archivedAt: null },
    select: { id: true, code: true, name: true, allowsLines: true },
  });
  const parsedExpenses = await parseExpenses(
    formData,
    expenseCategories,
    scope
  );
  if ("error" in parsedExpenses) return { error: parsedExpenses.error };
  base.expenses = parsedExpenses.expenses;

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

    // What THIS market handed the driver, off the rent row's own field. It is
    // the same figure twice over: the deduction on the market's bill, and the
    // debit that settles the transporter. One number, so the two cannot
    // disagree.
    if (type === "MARKET") {
      const rent = await prisma.expenseCategory.findUnique({
        where: {
          companyId_code: {
            companyId: scope.companyId,
            code: RENT_CATEGORY_CODE,
          },
        },
        select: { id: true },
      });
      if (rent) {
        const rentTotal = rentOnRows(base.expenses, rent.id);
        const paidByMarket = paidByMarketOn(base.expenses, rent.id);
        const advance = trip.advancePaid ?? ZERO;

        // Does THIS bill have anything to do with the rent at all?
        //
        // Most market bills do not. A truck stops at three markets; the rent is
        // one cost, entered once, and at most one of those bills settles any of
        // it. The other two are ordinary bills that happen to come off the same
        // trip.
        //
        // This used to be checked unconditionally, so a trip carrying an
        // advance made every bill off it unsaveable: with no rent row the sum
        // read "the advance of 5,000 and the 0.00 this market paid come to more
        // than the rent of 0.00", which is true and completely beside the
        // point. The first market to unload had to invent a rent voucher it did
        // not owe before it could record a sale.
        const carriesRent = rentTotal.gt(0) || paidByMarket.gt(0);

        // The driver cannot be handed more than he is owed. Advance plus what
        // the market gave him is capped by the rent itself, or the transporter
        // finishes the trip in credit — reading as "we have overpaid him",
        // which is a figure nobody could act on.
        if (carriesRent && advance.add(paidByMarket).gt(rentTotal))
          return {
            error:
              rentTotal.isZero()
                ? `This bill records ${paidByMarket.toFixed(2)} paid to the ` +
                  `driver but no rent for him to have been paid against. ` +
                  `Enter the trip's rent on the same row.`
                : `The advance of ${advance.toFixed(2)} and the ` +
                  `${paidByMarket.toFixed(2)} this market paid the driver ` +
                  `come to more than the rent of ${rentTotal.toFixed(2)}.`,
          };

        if (paidByMarket.gt(0)) base.rentDeducted = paidByMarket;
      }
    }
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

  // Rent posts TWICE, to two different parties, and neither is a deduction.
  //
  // What the market handed the driver settles part of what the market owes.
  // The bill DEBITs the whole net; this CREDITs back what they already paid,
  // as a receipt against that bill:
  //
  //   total 45,000 − commission 900 − reserve 1,500 − labour 500 = net 42,100
  //   DEBIT 42,100 · RECEIPT CREDIT 15,000  →  they owe 27,100
  //
  // which is the 27,100 printed on their paper. Same balance the old netting
  // arrived at — but "what did we bill them" and "what have they paid" are now
  // two questions with two answers, instead of one figure that had quietly been
  // reduced by a payment.
  //
  // The receipt is sourced from the SALE, so it carries no Settlement voucher.
  // That is deliberate: no cash crossed BFM's counter. It still drills through
  // to the bill on the party's statement, because source links resolve by id
  // across every voucher type.
  //
  // History worth keeping, since this looks like the bug that was fixed here
  // before: the old code CREDITed this amount against a net that was ALREADY
  // struck after the rent, which subtracted the same rupee twice and left every
  // market party who paid in full looking like a creditor. The credit is right
  // now only because the debit above grew by the same amount.
  //
  // And it SETTLES THE TRANSPORTER. The rent voucher credits him the whole
  // rent; the delivery note debited the advance handed over at loading; this
  // debits what the market handed him on the road. Without it he closes at
  // −15,000 on a trip somebody else already paid for.
  //
  //   rent 20,000 credited · advance 5,000 debited · market paid 15,000 debited
  //   → the transporter closes at zero, which is the truth: he has been paid.
  if (s.rentDeducted && s.rentDeducted.gt(0)) {
    entries.push({
      companyId: s.companyId,
      centreId: s.centreId,
      sourceId: s.id,
      date: s.date,
      partyId: s.ledgerPartyId,
      type: "CREDIT" as const,
      sourceType: "RECEIPT" as const,
      amount: s.rentDeducted,
    });
    // Only when the trip names a transporter. Off-trip there is nobody to
    // settle, and the market's own credit above still stands on its own.
    if (s.transporterId) {
      entries.push({
        companyId: s.companyId,
        centreId: s.centreId,
        sourceId: s.id,
        date: s.date,
        partyId: s.transporterId,
        type: "DEBIT" as const,
        sourceType: "RENT_BY_PARTY" as const,
        amount: s.rentDeducted,
      });
    }
  }

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
    cutting: d.cutting,
    cuttingRate: d.cuttingRate,
    otherDeduction: d.otherDeduction,
    deliveryNoteId: d.deliveryNoteId,
    rentDeducted: d.rentDeducted,
    notes: d.notes,
    weight: d.weight,
    netWeight: d.netWeight,
    waterLess: d.waterLess,
    totalBox: d.totalBox,
    vehicleNo: d.vehicleNo,
    placeOfLoading: d.placeOfLoading,
    returnNote: d.returnNote,
    lines: {
      create: d.lines.map((l, i) => ({
        // The row's place as typed — see the note on SaleLine.sortOrder.
        sortOrder: i,
        pack: l.pack,
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
      // The costs this bill revealed, as real expense vouchers dated to the
      // trip's buying day.
      await writeSaleExpenses(tx, {
        saleId: sale.id,
        companyId: company.id,
        centreId: centre.id,
        deliveryNoteId: d.deliveryNoteId,
        date: d.date,
        rows: d.expenses,
        userId: session.userId,
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

      // The costs entered ON this bill go with it, and their ledger entries go
      // first so the vendors they credited are recomputed. Done explicitly here
      // rather than by a database cascade: a cascade would drop the expense and
      // leave its ledger entry behind, which is exactly the orphan a running
      // balance cannot survive. The confirmation on screen names what will go,
      // so this is never a surprise.
      const raised = await tx.expense.findMany({
        where: { saleId },
        select: { id: true },
      });
      for (const x of raised) {
        await removeLedgerEntries(tx, {
          sourceId: x.id,
          sourceType: ["EXPENSE"],
        });
      }
      await tx.expense.deleteMany({ where: { saleId } });

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
      // The costs this bill revealed, as real expense vouchers dated to the
      // trip's buying day.
      await writeSaleExpenses(tx, {
        saleId: saleId,
        companyId: company.id,
        centreId: centre.id,
        deliveryNoteId: d.deliveryNoteId,
        date: d.date,
        rows: d.expenses,
        userId: session.userId,
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
