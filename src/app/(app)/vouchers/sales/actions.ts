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
import {
  COMMISSION_PARTY_NAME,
  RESERVE_PARTY_NAME,
} from "@/lib/settlement";
import {
  SALE_TYPES,
  SALE_BUYER_TYPE,
  SALE_TYPE_ALLOWS_CARE_OF,
  commissionAmount,
  MAX_COMMISSION_RATE,
} from "@/lib/sale";
import { clearErrorFlag } from "@/lib/errorflag";
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
  withBoxCount: boolean
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
    if (!DECIMAL3.test(qtyRaw) || Number(qtyRaw) <= 0)
      return { error: `Qty for “${p}” must be a positive number.` };
    if (!DECIMAL2.test(rateRaw))
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

    const qtyKg = new Prisma.Decimal(qtyRaw);
    const ratePerKg = new Prisma.Decimal(rateRaw);
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

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const type = String(formData.get("type") ?? "") as SaleType;
  if (!SALE_TYPES.includes(type)) return { error: "Choose a sale type." };

  const billNo = clean(formData.get("billNo"));
  const dateRaw = String(formData.get("date") ?? "");
  const saleDateRaw = String(formData.get("saleDate") ?? "");
  const buyerName = clean(formData.get("buyerName"));
  const file = formData.get("bill");

  if (!billNo) return { error: "Enter the bill number." };
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
    const netBill = parseMoney(clean(formData.get("netBill")));
    if (!totalBill || totalBill.lte(0))
      return { error: "Total Bill must be a positive number." };
    if (!netBill || netBill.lte(0))
      return { error: "Net Bill must be a positive number." };
    // Net is Total less the seller's profit and expenses, so it is a part of
    // the gross and can never exceed it. Net is also what posts to the ledger,
    // so an inverted pair silently overstates what the seller owes us.
    if (netBill.greaterThan(totalBill))
      return {
        error:
          `Net Bill (${netBill.toFixed(2)}) cannot be more than Total Bill ` +
          `(${totalBill.toFixed(2)}) — net is the gross less the seller's ` +
          `profit and expenses.`,
      };
    // The rate is per-bill now. Blank means no commission on this sale, which
    // is a real case — not every Market bill carries one — so it is allowed
    // rather than defaulted, and 0 stores nothing rather than a zero entry.
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

    // Withheld from the seller and held on their behalf. Deliberately NOT
    // subtracted from `amount`: the net bill is what the seller owes for the
    // fish, and netting a retention against it would misstate both the debt
    // and the day's revenue.
    const reserveRaw = clean(formData.get("reserve"));
    let reserve: Prisma.Decimal | null = null;
    if (reserveRaw) {
      const parsed = parseMoney(reserveRaw);
      if (!parsed || parsed.lt(0))
        return { error: "Reserve cannot be negative." };
      if (parsed.gt(totalBill))
        return {
          error:
            `Reserve (${parsed.toFixed(2)}) cannot be more than Total Bill ` +
            `(${totalBill.toFixed(2)}).`,
        };
      reserve = parsed.gt(0) ? parsed : null;
    }

    base.place = clean(formData.get("place")) || null;
    base.vehicleNo = clean(formData.get("vehicleNo")) || null;
    base.totalBill = totalBill;
    base.commissionRate = commissionRate;
    // Computed through the same helper the form previews with, so the figure
    // the clerk approved and the figure stored are never two calculations.
    base.commission =
      commissionRate && commissionRate.gt(0)
        ? new Prisma.Decimal(
            commissionAmount(totalBill.toNumber(), commissionRate.toNumber())
          ).toDecimalPlaces(2)
        : null;
    base.reserve = reserve;
    amount = netBill; // Net Bill is what the seller owes us = the sale revenue
  } else if (type === "FACTORY") {
    const billAmount = parseMoney(clean(formData.get("amount")));
    if (!billAmount || billAmount.lte(0))
      return { error: "Bill amount total must be a positive number." };
    base.vehicleNo = clean(formData.get("vehicleNo")) || null;
    base.returnNote = clean(formData.get("returnNote")) || null;
    amount = billAmount;
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

  // Every sale type carries a remark. Read once here rather than in each
  // branch, because it is the one field that means the same thing on all four.
  base.notes = clean(formData.get("notes")) || null;

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

  if (s.commission && s.commission.gt(0)) {
    const commissionPartyId = await findOrCreateParty(
      tx,
      COMMISSION_PARTY_NAME,
      "COMMISSION"
    );
    // DEBIT: commission earned is income accruing to us, so the account grows
    // in the same direction as money owed to us.
    entries.push({
      companyId: s.companyId,
      centreId: s.centreId,
      partyId: commissionPartyId,
      type: "DEBIT" as const,
      sourceType: "COMMISSION" as const,
      sourceId: s.id,
      amount: s.commission,
      date: s.date,
    });
  }

  if (s.reserve && s.reserve.gt(0)) {
    const reservePartyId = await findOrCreateParty(
      tx,
      RESERVE_PARTY_NAME,
      "RESERVE"
    );
    // CREDIT, opposite to commission, and the sign is the whole point: money
    // held back is money we owe the seller, not income we earned. Posting it
    // DEBIT like commission would read as the house being owed its own
    // retention, and the two accounts would then sum to something meaningless.
    entries.push({
      companyId: s.companyId,
      centreId: s.centreId,
      partyId: reservePartyId,
      type: "CREDIT" as const,
      sourceType: "RESERVE" as const,
      sourceId: s.id,
      amount: s.reserve,
      date: s.date,
    });
  }

  await postLedgerEntries(tx, entries);
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

export async function createSale(
  _prev: SaleFormState,
  formData: FormData
): Promise<SaleFormState> {
  const session = await requireEntry();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const scoped = await requireSubmittedScope(formData);
  if ("error" in scoped) return { error: scoped.error };
  const { company, centre } = scoped.scope;

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
        date: d.date,
      });
      await linkStagedAttachment(tx, staged, {
        companyId: company.id,
        centreId: centre.id,
        linkedType: "SALE",
        linkedId: sale.id,
      });
      return sale.id;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save sale." };
  }

  revalidatePath("/vouchers/sales");
  revalidatePath("/ledgers", "layout");
  redirect(`/vouchers/sales/${saleId}`);
}

/**
 * Delete a sale outright.
 *
 * A Market sale posts to two ledgers — the buyer (or the CareOf agent) and the
 * house commission account — and removeLedgerEntries repairs both, because it
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
        select: { id: true },
      });
      if (!existing) throw new Error("Sale not found.");

      await removeLedgerEntries(tx, { sourceId: saleId });
      await unlinkAttachments(tx, "SALE", saleId);
      await clearErrorFlag(tx, "SALE", saleId);
      // Removing the voucher answers any request against it. The request rows
      // themselves survive — they record that a correction was asked for.
      await resolveReviews(tx, "SALE", saleId, session.userId);
      await tx.sale.delete({ where: { id: saleId } });
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
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    const staged = await stageAttachmentFile(d.file);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findFirst({
        // Scoped: an admin may only change or remove a voucher that belongs to
        // the company and centre they are currently working in.
        where: { id: saleId, companyId: company.id, centreId: centre.id },
        select: { companyId: true, centreId: true, date: true },
      });
      if (!existing) throw new Error("Sale not found.");

      // Rebuilds the old ledger party's statement too, in case this edit
      // reassigns the buyer or routes the sale via a different CareOf agent.
      await removeLedgerEntries(tx, {
        sourceId: saleId,
        sourceType: ["SALE", "PAYMENT", "RECEIPT", "COMMISSION"],
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
        date: d.date,
      });
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
    return { error: e instanceof Error ? e.message : "Could not save sale." };
  }

  revalidatePath("/vouchers/sales");
  revalidatePath("/ledgers", "layout");
  revalidatePath("/dashboard");
  redirect(`/vouchers/sales/${saleId}`);
}
