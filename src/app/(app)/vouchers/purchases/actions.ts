"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { PurchaseType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { requireActiveScope } from "@/lib/centre";
import { PURCHASE_SELLER_TYPE } from "@/lib/party";
import { findOrCreateParty } from "@/lib/party-db";
import { postLedgerEntry } from "@/lib/ledger";
import { saveAttachmentFile, validateImageFile } from "@/lib/attachments";

export type PurchaseFormState = { error: string } | null;

const PURCHASE_TYPES: PurchaseType[] = ["SOCIETY", "KFDC", "PRIVATE", "LOCAL"];

type ParsedLine = {
  particular: string;
  qtyKg: Prisma.Decimal;
  pricePerKg: Prisma.Decimal;
  total: Prisma.Decimal;
};

type Parsed = {
  type: PurchaseType;
  partyName: string;
  amount: Prisma.Decimal;
  paid: boolean;
  date: Date;
  lines: ParsedLine[];
  file: unknown;
};

const DECIMAL2 = /^\d+(\.\d{1,2})?$/;
const DECIMAL3 = /^\d+(\.\d{1,3})?$/;

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const type = String(formData.get("type") ?? "") as PurchaseType;
  const partyName = String(formData.get("partyName") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const dateRaw = String(formData.get("date") ?? "");
  const paid = formData.get("paid") != null;
  const file = formData.get("bill");

  if (!PURCHASE_TYPES.includes(type))
    return { error: "Choose a purchase type." };
  if (!partyName)
    return {
      error: type === "LOCAL" ? "Enter the seller name." : "Enter the boat name.",
    };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };

  const badFile = validateImageFile(file);
  if (badFile) return { error: badFile };

  const date = new Date(dateRaw);

  if (type === "LOCAL") {
    const particulars = formData.getAll("particular").map(String);
    const qtys = formData.getAll("qtyKg").map(String);
    const prices = formData.getAll("pricePerKg").map(String);
    const lines: ParsedLine[] = [];
    for (let i = 0; i < particulars.length; i++) {
      const particular = particulars[i].trim().replace(/\s+/g, " ");
      const qtyRaw = (qtys[i] ?? "").trim();
      const priceRaw = (prices[i] ?? "").trim();
      // Skip fully-blank rows the form may submit.
      if (!particular && !qtyRaw && !priceRaw) continue;
      if (!particular) return { error: "Every line needs a particular." };
      if (!DECIMAL3.test(qtyRaw) || Number(qtyRaw) <= 0)
        return { error: `Quantity for “${particular}” must be a positive number.` };
      if (!DECIMAL2.test(priceRaw))
        return { error: `Price for “${particular}” must be a number.` };
      const qtyKg = new Prisma.Decimal(qtyRaw);
      const pricePerKg = new Prisma.Decimal(priceRaw);
      lines.push({
        particular,
        qtyKg,
        pricePerKg,
        total: qtyKg.mul(pricePerKg),
      });
    }
    if (lines.length === 0)
      return { error: "Add at least one line item." };
    const amount = lines.reduce((a, l) => a.add(l.total), new Prisma.Decimal(0));
    return { data: { type, partyName, amount, paid, date, lines, file } };
  }

  const amountRaw = String(formData.get("amount") ?? "").trim();
  if (!DECIMAL2.test(amountRaw) || Number(amountRaw) <= 0)
    return { error: "Total must be a positive number (up to 2 decimals)." };
  return {
    data: {
      type,
      partyName,
      amount: new Prisma.Decimal(amountRaw),
      paid,
      date,
      lines: [],
      file,
    },
  };
}

/**
 * Purchase ledger effect: CREDIT the seller (we owe them). When paid, an
 * immediate DEBIT PAYMENT nets it to zero but keeps the statement complete;
 * when unpaid, the CREDIT stands as an outstanding balance.
 */
async function postPurchaseLedger(
  tx: Prisma.TransactionClient,
  p: { companyId: string; centreId: string; partyId: string; id: string; amount: Prisma.Decimal; date: Date; paid: boolean }
) {
  await postLedgerEntry(tx, {
    companyId: p.companyId,
    centreId: p.centreId,
    partyId: p.partyId,
    type: "CREDIT",
    sourceType: "PURCHASE",
    sourceId: p.id,
    amount: p.amount,
    date: p.date,
  });
  if (p.paid) {
    await postLedgerEntry(tx, {
      companyId: p.companyId,
      centreId: p.centreId,
      partyId: p.partyId,
      type: "DEBIT",
      sourceType: "PAYMENT",
      sourceId: p.id,
      amount: p.amount,
      date: p.date,
    });
  }
}

export async function createPurchase(
  _prev: PurchaseFormState,
  formData: FormData
): Promise<PurchaseFormState> {
  const session = await requireEntry();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const { company, centre } = await requireActiveScope();

  let purchaseId: string;
  try {
    purchaseId = await prisma.$transaction(async (tx) => {
      const partyId = await findOrCreateParty(
        tx,
        d.partyName,
        PURCHASE_SELLER_TYPE[d.type]
      );
      const purchase = await tx.purchase.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          partyId,
          type: d.type,
          amount: d.amount,
          paid: d.paid,
          date: d.date,
          createdById: session.userId,
          lines: { create: d.lines },
        },
      });
      await postPurchaseLedger(tx, { ...purchase, ...d });
      return purchase.id;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save purchase." };
  }

  await saveAttachmentFile({
    companyId: company.id,
    centreId: centre.id,
    linkedType: "PURCHASE",
    linkedId: purchaseId,
    file: d.file,
  });

  revalidatePath("/vouchers/purchases");
  redirect("/vouchers/purchases");
}

/**
 * Open-day edit: re-post the purchase's ledger effect and lines atomically.
 */
export async function updatePurchase(
  purchaseId: string,
  _prev: PurchaseFormState,
  formData: FormData
): Promise<PurchaseFormState> {
  const session = await requireAdmin();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.purchase.findUnique({ where: { id: purchaseId } });
      if (!existing) throw new Error("Purchase not found.");

      await tx.ledgerEntry.deleteMany({
        where: { sourceId: purchaseId, sourceType: { in: ["PURCHASE", "PAYMENT"] } },
      });
      await tx.purchaseLine.deleteMany({ where: { purchaseId } });

      const partyId = await findOrCreateParty(
        tx,
        d.partyName,
        PURCHASE_SELLER_TYPE[d.type]
      );
      const purchase = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          partyId,
          type: d.type,
          amount: d.amount,
          paid: d.paid,
          date: d.date,
          updatedById: session.userId,
          updatedAt: new Date(),
          lines: { create: d.lines },
        },
      });
      await postPurchaseLedger(tx, { ...purchase, ...d });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save purchase." };
  }

  const scope = (await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { companyId: true, centreId: true },
  }))!;
  await saveAttachmentFile({
    companyId: scope.companyId,
    centreId: scope.centreId,
    linkedType: "PURCHASE",
    linkedId: purchaseId,
    file: d.file,
  });

  revalidatePath("/vouchers/purchases");
  redirect("/vouchers/purchases");
}
