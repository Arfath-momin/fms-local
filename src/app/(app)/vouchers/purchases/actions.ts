"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { PurchaseType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { assertDayOpen } from "@/lib/dayclose";
import { postLedgerEntry } from "@/lib/ledger";
import { getNetQty, postStockMovement } from "@/lib/stock";

export type PurchaseFormState = { error: string } | null;

const PURCHASE_TYPES: PurchaseType[] = ["SOCIETY", "PRIVATE", "LOCAL"];

type Parsed = {
  type: PurchaseType;
  partyId: string;
  invoiceNumber: string; // may be "" for LOCAL → auto-numbered
  fishType: string;
  qtyKg: Prisma.Decimal;
  amount: Prisma.Decimal;
  date: Date;
};

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const type = String(formData.get("type") ?? "") as PurchaseType;
  const partyId = String(formData.get("partyId") ?? "");
  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim();
  const fishType = String(formData.get("fishType") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const qtyRaw = String(formData.get("qtyKg") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const dateRaw = String(formData.get("date") ?? "");

  if (!PURCHASE_TYPES.includes(type))
    return { error: "Choose a purchase type." };
  if (!partyId) return { error: "Choose a party." };
  if (!invoiceNumber && type !== "LOCAL")
    return { error: "Invoice number is required for this purchase type." };
  if (!fishType) return { error: "Fish type is required." };
  if (!/^\d+(\.\d{1,3})?$/.test(qtyRaw) || Number(qtyRaw) <= 0)
    return { error: "Quantity must be a positive number (up to 3 decimals)." };
  if (!/^\d+(\.\d{1,2})?$/.test(amountRaw))
    return { error: "Amount must be a number (up to 2 decimals)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw))
    return { error: "Pick a date." };

  return {
    data: {
      type,
      partyId,
      invoiceNumber,
      fishType,
      qtyKg: new Prisma.Decimal(qtyRaw),
      amount: new Prisma.Decimal(amountRaw),
      date: new Date(dateRaw),
    },
  };
}

async function nextLocalInvoice(
  tx: Prisma.TransactionClient,
  companyId: string
) {
  const { localInvoiceSeq } = await tx.company.update({
    where: { id: companyId },
    data: { localInvoiceSeq: { increment: 1 } },
    select: { localInvoiceSeq: true },
  });
  return `LOC-AUTO-${String(localInvoiceSeq).padStart(4, "0")}`;
}

/**
 * On save (spec §2 Purchase): stock IN → AVAILABLE, plus a paid-same-day
 * ledger pair — CREDIT (PURCHASE: we owe the seller) immediately matched by
 * DEBIT (PAYMENT), since there is no advance/credit modeling (spec §3.5).
 * The pair nets to zero but keeps the party statement a complete history.
 */
async function postPurchaseEffects(
  tx: Prisma.TransactionClient,
  purchase: {
    id: string;
    companyId: string;
    partyId: string;
    fishType: string;
    qtyKg: Prisma.Decimal;
    amount: Prisma.Decimal;
    date: Date;
  }
) {
  await postStockMovement(tx, {
    companyId: purchase.companyId,
    fishType: purchase.fishType,
    qtyKg: purchase.qtyKg,
    direction: "IN",
    state: "AVAILABLE",
    sourceType: "PURCHASE",
    sourceId: purchase.id,
    date: purchase.date,
  });
  await postLedgerEntry(tx, {
    companyId: purchase.companyId,
    partyId: purchase.partyId,
    type: "CREDIT",
    sourceType: "PURCHASE",
    sourceId: purchase.id,
    amount: purchase.amount,
    date: purchase.date,
  });
  await postLedgerEntry(tx, {
    companyId: purchase.companyId,
    partyId: purchase.partyId,
    type: "DEBIT",
    sourceType: "PAYMENT",
    sourceId: purchase.id,
    amount: purchase.amount,
    date: purchase.date,
  });
}

export async function createPurchase(
  _prev: PurchaseFormState,
  formData: FormData
): Promise<PurchaseFormState> {
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const company = await getActiveCompany();

  try {
    await prisma.$transaction(async (tx) => {
      await assertDayOpen(tx, company.id, d.date);
      const invoiceNumber =
        d.invoiceNumber || (await nextLocalInvoice(tx, company.id));
      const purchase = await tx.purchase.create({
        data: {
          companyId: company.id,
          partyId: d.partyId,
          type: d.type,
          invoiceNumber,
          fishType: d.fishType,
          qtyKg: d.qtyKg,
          amount: d.amount,
          date: d.date,
        },
      });
      await postPurchaseEffects(tx, purchase);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { error: "This invoice number already exists for this company." };
    return { error: e instanceof Error ? e.message : "Could not save purchase." };
  }

  revalidatePath("/vouchers/purchases");
  redirect("/vouchers/purchases");
}

/**
 * Direct edits are allowed only while the day is open (spec §2 DayClose).
 * The edit re-posts the purchase's stock and ledger effects atomically, and
 * refuses if the change would drive available stock negative (e.g. qty was
 * already dispatched).
 */
export async function updatePurchase(
  purchaseId: string,
  _prev: PurchaseFormState,
  formData: FormData
): Promise<PurchaseFormState> {
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.purchase.findUnique({
        where: { id: purchaseId },
      });
      if (!existing) throw new Error("Purchase not found.");

      await assertDayOpen(tx, existing.companyId, existing.date);
      await assertDayOpen(tx, existing.companyId, d.date);

      await tx.stockMovement.deleteMany({
        where: { sourceType: "PURCHASE", sourceId: purchaseId },
      });
      await tx.ledgerEntry.deleteMany({
        where: {
          sourceId: purchaseId,
          sourceType: { in: ["PURCHASE", "PAYMENT"] },
        },
      });

      const purchase = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          partyId: d.partyId,
          type: d.type,
          // Blank invoice on a LOCAL edit keeps the existing auto number.
          invoiceNumber: d.invoiceNumber || existing.invoiceNumber,
          fishType: d.fishType,
          qtyKg: d.qtyKg,
          amount: d.amount,
          date: d.date,
        },
      });
      await postPurchaseEffects(tx, purchase);

      for (const fishType of new Set([existing.fishType, purchase.fishType])) {
        const net = await getNetQty(
          tx,
          existing.companyId,
          fishType,
          "AVAILABLE"
        );
        if (net.isNegative()) {
          throw new Error(
            `Cannot save: available stock of ${fishType} would go negative — some of this purchase has already been dispatched or sold.`
          );
        }
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { error: "This invoice number already exists for this company." };
    return { error: e instanceof Error ? e.message : "Could not save purchase." };
  }

  revalidatePath("/vouchers/purchases");
  redirect("/vouchers/purchases");
}
