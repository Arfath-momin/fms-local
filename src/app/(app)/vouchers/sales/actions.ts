"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { SaleType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/session";
import { requireActiveScope } from "@/lib/centre";
import { assertDayOpen } from "@/lib/dayclose";
import { postLedgerEntry } from "@/lib/ledger";
import { findOrCreateParty } from "@/lib/party-db";
import {
  SALE_TYPES,
  SALE_BUYER_TYPE,
  SALE_TYPE_ALLOWS_CARE_OF,
  MARKET_COMMISSION_RATE,
} from "@/lib/sale";
import { saveAttachmentFile, validateImageFile } from "@/lib/attachments";

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
  date: Date;
  buyerName: string;
  careOfName: string | null;
  amount: Prisma.Decimal; // recognised sale + posted to ledger
  amountReceived: Prisma.Decimal;
  // type-specific
  place: string | null;
  totalBill: Prisma.Decimal | null;
  commission: Prisma.Decimal | null;
  weight: Prisma.Decimal | null;
  netWeight: Prisma.Decimal | null;
  vehicleNo: string | null;
  placeOfLoading: string | null;
  returnNote: string | null;
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
    lines.push({ particular: p, box, qtyKg, ratePerKg, count, total: qtyKg.mul(ratePerKg) });
  }
  return { lines };
}

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const type = String(formData.get("type") ?? "") as SaleType;
  if (!SALE_TYPES.includes(type)) return { error: "Choose a sale type." };

  const billNo = clean(formData.get("billNo"));
  const dateRaw = String(formData.get("date") ?? "");
  const buyerName = clean(formData.get("buyerName"));
  const receivedRaw = clean(formData.get("amountReceived"));
  const file = formData.get("bill");

  if (!billNo) return { error: "Enter the bill number." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };
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
    buyerName,
    careOfName,
    place: null as string | null,
    totalBill: null as Prisma.Decimal | null,
    commission: null as Prisma.Decimal | null,
    weight: null as Prisma.Decimal | null,
    netWeight: null as Prisma.Decimal | null,
    vehicleNo: null as string | null,
    placeOfLoading: null as string | null,
    returnNote: null as string | null,
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
    base.place = clean(formData.get("place")) || null;
    base.totalBill = totalBill;
    base.commission = totalBill.mul(MARKET_COMMISSION_RATE);
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

  let amountReceived = ZERO;
  if (receivedRaw) {
    const r = parseMoney(receivedRaw);
    if (!r) return { error: "Amount received must be a number (up to 2 decimals)." };
    amountReceived = r;
  }
  if (amountReceived.gt(amount))
    return { error: "Amount received cannot exceed the sale amount." };

  return { data: { ...base, amount, amountReceived } };
}

/**
 * Ledger effect of a sale: DEBIT the party who owes us (the buyer, or the
 * CareOf agent when routed via CareOf) for the full sale amount; CREDIT a
 * PAYMENT for whatever's been received. Any shortfall stands as outstanding.
 */
async function postSaleLedger(
  tx: Prisma.TransactionClient,
  s: {
    companyId: string;
    centreId: string;
    ledgerPartyId: string;
    id: string;
    amount: Prisma.Decimal;
    amountReceived: Prisma.Decimal;
    date: Date;
  }
) {
  await postLedgerEntry(tx, {
    companyId: s.companyId,
    centreId: s.centreId,
    partyId: s.ledgerPartyId,
    type: "DEBIT",
    sourceType: "SALE",
    sourceId: s.id,
    amount: s.amount,
    date: s.date,
  });
  if (s.amountReceived.gt(0)) {
    await postLedgerEntry(tx, {
      companyId: s.companyId,
      centreId: s.centreId,
      partyId: s.ledgerPartyId,
      type: "CREDIT",
      sourceType: "PAYMENT",
      sourceId: s.id,
      amount: s.amountReceived,
      date: s.date,
    });
  }
}

function saleData(d: Parsed, buyerId: string, careOfId: string | null) {
  return {
    type: d.type,
    partyId: buyerId,
    careOfPartyId: careOfId,
    billNo: d.billNo,
    date: d.date,
    amount: d.amount,
    amountReceived: d.amountReceived,
    place: d.place,
    totalBill: d.totalBill,
    commission: d.commission,
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
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const { company, centre } = await requireActiveScope();

  let saleId: string;
  try {
    saleId = await prisma.$transaction(async (tx) => {
      await assertDayOpen(tx, company.id, centre.id, d.date);
      const buyerId = await findOrCreateParty(tx, d.buyerName, SALE_BUYER_TYPE[d.type]);
      const careOfId = d.careOfName
        ? await findOrCreateParty(tx, d.careOfName, "CARE_OF")
        : null;
      const sale = await tx.sale.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          ...saleData(d, buyerId, careOfId),
        },
      });
      await postSaleLedger(tx, {
        companyId: company.id,
        centreId: centre.id,
        ledgerPartyId: careOfId ?? buyerId,
        id: sale.id,
        amount: d.amount,
        amountReceived: d.amountReceived,
        date: d.date,
      });
      return sale.id;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save sale." };
  }

  await saveAttachmentFile({
    companyId: company.id,
    centreId: centre.id,
    linkedType: "SALE",
    linkedId: saleId,
    file: d.file,
  });

  revalidatePath("/vouchers/sales");
  redirect(`/vouchers/sales/${saleId}`);
}

export async function updateSale(
  saleId: string,
  _prev: SaleFormState,
  formData: FormData
): Promise<SaleFormState> {
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  let scope: { companyId: string; centreId: string };
  try {
    scope = await prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findUnique({
        where: { id: saleId },
        select: { companyId: true, centreId: true, date: true },
      });
      if (!existing) throw new Error("Sale not found.");
      await assertDayOpen(tx, existing.companyId, existing.centreId, existing.date);
      await assertDayOpen(tx, existing.companyId, existing.centreId, d.date);

      await tx.ledgerEntry.deleteMany({
        where: { sourceId: saleId, sourceType: { in: ["SALE", "PAYMENT"] } },
      });
      await tx.saleLine.deleteMany({ where: { saleId } });

      const buyerId = await findOrCreateParty(tx, d.buyerName, SALE_BUYER_TYPE[d.type]);
      const careOfId = d.careOfName
        ? await findOrCreateParty(tx, d.careOfName, "CARE_OF")
        : null;
      await tx.sale.update({
        where: { id: saleId },
        data: saleData(d, buyerId, careOfId),
      });
      await postSaleLedger(tx, {
        companyId: existing.companyId,
        centreId: existing.centreId,
        ledgerPartyId: careOfId ?? buyerId,
        id: saleId,
        amount: d.amount,
        amountReceived: d.amountReceived,
        date: d.date,
      });
      return { companyId: existing.companyId, centreId: existing.centreId };
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save sale." };
  }

  await saveAttachmentFile({
    companyId: scope.companyId,
    centreId: scope.centreId,
    linkedType: "SALE",
    linkedId: saleId,
    file: d.file,
  });

  revalidatePath("/vouchers/sales");
  redirect(`/vouchers/sales/${saleId}`);
}
