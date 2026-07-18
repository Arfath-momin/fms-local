"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { assertDayOpen } from "@/lib/dayclose";
import { postLedgerEntry } from "@/lib/ledger";
import { getNetQty, postStockMovement } from "@/lib/stock";

export type DirectSaleFormState = { error: string } | null;

type Parsed = {
  partyId: string;
  fishType: string;
  qtyKg: Prisma.Decimal;
  rate: Prisma.Decimal;
  amount: Prisma.Decimal;
  date: Date;
};

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const partyId = String(formData.get("partyId") ?? "");
  const fishType = String(formData.get("fishType") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const qtyRaw = String(formData.get("qtyKg") ?? "").trim();
  const rateRaw = String(formData.get("rate") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const dateRaw = String(formData.get("date") ?? "");

  if (!partyId) return { error: "Choose a buyer." };
  if (!fishType) return { error: "Choose a fish type." };
  if (!/^\d+(\.\d{1,3})?$/.test(qtyRaw) || Number(qtyRaw) <= 0)
    return { error: "Quantity must be a positive number (up to 3 decimals)." };
  if (!/^\d+(\.\d{1,2})?$/.test(rateRaw) || Number(rateRaw) <= 0)
    return { error: "Rate must be a positive number (up to 2 decimals)." };
  if (!/^\d+(\.\d{1,2})?$/.test(amountRaw))
    return { error: "Amount must be a number (up to 2 decimals)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };

  return {
    data: {
      partyId,
      fishType,
      qtyKg: new Prisma.Decimal(qtyRaw),
      rate: new Prisma.Decimal(rateRaw),
      amount: new Prisma.Decimal(amountRaw),
      date: new Date(dateRaw),
    },
  };
}

/**
 * Quick local-sale path (spec §2 DirectSale): stock AVAILABLE → SOLD in one
 * step and the ledger posted immediately — DEBIT SALE for the deal amount
 * matched by a same-day CREDIT PAYMENT, since a direct sale is cash-settled
 * on the spot (no delivery/settlement split, no variance concept).
 */
async function postDirectSaleEffects(
  tx: Prisma.TransactionClient,
  sale: {
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
    companyId: sale.companyId,
    fishType: sale.fishType,
    qtyKg: sale.qtyKg,
    direction: "OUT",
    state: "AVAILABLE",
    sourceType: "DIRECT_SALE",
    sourceId: sale.id,
    date: sale.date,
  });
  await postStockMovement(tx, {
    companyId: sale.companyId,
    fishType: sale.fishType,
    qtyKg: sale.qtyKg,
    direction: "IN",
    state: "SOLD",
    sourceType: "DIRECT_SALE",
    sourceId: sale.id,
    date: sale.date,
  });
  await postLedgerEntry(tx, {
    companyId: sale.companyId,
    partyId: sale.partyId,
    type: "DEBIT",
    sourceType: "SALE",
    sourceId: sale.id,
    amount: sale.amount,
    date: sale.date,
  });
  await postLedgerEntry(tx, {
    companyId: sale.companyId,
    partyId: sale.partyId,
    type: "CREDIT",
    sourceType: "PAYMENT",
    sourceId: sale.id,
    amount: sale.amount,
    date: sale.date,
  });
}

export async function createDirectSale(
  _prev: DirectSaleFormState,
  formData: FormData
): Promise<DirectSaleFormState> {
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const company = await getActiveCompany();

  try {
    await prisma.$transaction(async (tx) => {
      await assertDayOpen(tx, company.id, d.date);

      const available = await getNetQty(tx, company.id, d.fishType, "AVAILABLE");
      if (available.lessThan(d.qtyKg)) {
        throw new Error(
          `Only ${available.toString()} kg of ${d.fishType} is available — cannot sell ${d.qtyKg.toString()} kg.`
        );
      }

      const sale = await tx.directSale.create({
        data: { companyId: company.id, ...d },
      });
      await postDirectSaleEffects(tx, sale);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save sale." };
  }

  revalidatePath("/vouchers/direct-sales");
  redirect("/vouchers/direct-sales");
}

/** Closed-day correction — see correctPurchase for the pattern. */
export async function correctDirectSale(
  saleId: string,
  _prev: DirectSaleFormState,
  formData: FormData
): Promise<DirectSaleFormState> {
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const reason = String(formData.get("reason") ?? "").trim();

  try {
    await prisma.$transaction(async (tx) => {
      const original = await tx.directSale.findUnique({ where: { id: saleId } });
      if (!original) throw new Error("Sale not found.");

      const already = await tx.errorFlag.findUnique({
        where: { linkedType_linkedId: { linkedType: "DIRECT_SALE", linkedId: saleId } },
      });
      if (already) throw new Error("This sale has already been corrected.");

      const flag = await tx.errorFlag.create({
        data: {
          linkedType: "DIRECT_SALE",
          linkedId: saleId,
          reason: reason || null,
        },
      });

      await tx.stockMovement.deleteMany({
        where: { sourceType: "DIRECT_SALE", sourceId: saleId },
      });
      await tx.ledgerEntry.deleteMany({
        where: { sourceId: saleId, sourceType: { in: ["SALE", "PAYMENT"] } },
      });

      const replacement = await tx.directSale.create({
        data: { companyId: original.companyId, ...d },
      });
      await postDirectSaleEffects(tx, replacement);

      for (const fishType of new Set([original.fishType, d.fishType])) {
        const net = await getNetQty(tx, original.companyId, fishType, "AVAILABLE");
        if (net.isNegative()) {
          throw new Error(
            `Cannot correct: available stock of ${fishType} would go negative.`
          );
        }
      }

      await tx.errorFlag.update({
        where: { id: flag.id },
        data: { correctingEntryId: replacement.id },
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save correction." };
  }

  revalidatePath("/vouchers/direct-sales");
  redirect("/vouchers/direct-sales");
}

/** Open-day edit: re-posts stock and ledger effects atomically. */
export async function updateDirectSale(
  saleId: string,
  _prev: DirectSaleFormState,
  formData: FormData
): Promise<DirectSaleFormState> {
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.directSale.findUnique({ where: { id: saleId } });
      if (!existing) throw new Error("Sale not found.");

      await assertDayOpen(tx, existing.companyId, existing.date);
      await assertDayOpen(tx, existing.companyId, d.date);

      await tx.stockMovement.deleteMany({
        where: { sourceType: "DIRECT_SALE", sourceId: saleId },
      });
      await tx.ledgerEntry.deleteMany({
        where: { sourceId: saleId, sourceType: { in: ["SALE", "PAYMENT"] } },
      });

      const sale = await tx.directSale.update({
        where: { id: saleId },
        data: d,
      });
      await postDirectSaleEffects(tx, sale);

      for (const fishType of new Set([existing.fishType, d.fishType])) {
        const net = await getNetQty(tx, existing.companyId, fishType, "AVAILABLE");
        if (net.isNegative()) {
          throw new Error(
            `Cannot save: available stock of ${fishType} would go negative.`
          );
        }
      }
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save sale." };
  }

  revalidatePath("/vouchers/direct-sales");
  redirect("/vouchers/direct-sales");
}
