"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { PurchaseType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { requireActiveScope } from "@/lib/centre";
import { FIXED_PURCHASE_PARTY, PURCHASE_BOAT_TYPE } from "@/lib/party";
import { findOrCreateParty } from "@/lib/party-db";
import { postLedgerEntries, removeLedgerEntries } from "@/lib/ledger";
import {
  linkStagedAttachment,
  replaceStagedAttachment,
  stageAttachmentFile,
  validateImageFile,
} from "@/lib/attachments";

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
  /** The ledger this purchase settles against. */
  partyName: string;
  /** The boat (Society/KFDC/Private) or seller (Local) — recorded, not a ledger. */
  boatName: string;
  amount: Prisma.Decimal;
  date: Date;
  lines: ParsedLine[];
  file: unknown;
};

const clean = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");

const DECIMAL2 = /^\d+(\.\d{1,2})?$/;
const DECIMAL3 = /^\d+(\.\d{1,3})?$/;

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const type = String(formData.get("type") ?? "") as PurchaseType;
  const boatName = clean(formData.get("boatName"));
  const dateRaw = String(formData.get("date") ?? "");
  const file = formData.get("bill");

  if (!PURCHASE_TYPES.includes(type))
    return { error: "Choose a purchase type." };
  if (!boatName)
    return {
      error: type === "LOCAL" ? "Enter the seller name." : "Enter the boat name.",
    };

  // Society / KFDC / Local settle against one standing account each, so the
  // type names the ledger. Private has no single counterparty — the party is
  // typed and carries its own ledger, with the boat alongside it as detail.
  const fixed = FIXED_PURCHASE_PARTY[type];
  const partyName = fixed ?? clean(formData.get("partyName"));
  if (!partyName) return { error: "Enter the party name." };

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
    return { data: { type, partyName, boatName, amount, date, lines, file } };
  }

  const amountRaw = String(formData.get("amount") ?? "").trim();
  if (!DECIMAL2.test(amountRaw) || Number(amountRaw) <= 0)
    return { error: "Total must be a positive number (up to 2 decimals)." };
  return {
    data: {
      type,
      partyName,
      boatName,
      amount: new Prisma.Decimal(amountRaw),
      date,
      lines: [],
      file,
    },
  };
}

/**
 * Purchase ledger effect: CREDIT the seller, because we now owe them.
 *
 * Nothing here settles the debt. A purchase used to carry a "paid" checkbox
 * that posted an offsetting DEBIT under the purchase's own id, which made the
 * trade and its payment one record. Settlement is now a Payment voucher, so
 * the balance this leaves standing is the real outstanding amount until one is
 * entered against it.
 */
async function postPurchaseLedger(
  tx: Prisma.TransactionClient,
  p: {
    companyId: string;
    centreId: string;
    partyId: string;
    id: string;
    amount: Prisma.Decimal;
    date: Date;
  }
) {
  await postLedgerEntries(tx, [
    {
      companyId: p.companyId,
      centreId: p.centreId,
      partyId: p.partyId,
      type: "CREDIT",
      sourceType: "PURCHASE",
      sourceId: p.id,
      amount: p.amount,
      date: p.date,
    },
  ]);
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

  try {
    // Staged before the transaction so a rejected image aborts the save
    // instead of leaving a purchase with no bill against it.
    const staged = await stageAttachmentFile(d.file);
    await prisma.$transaction(async (tx) => {
      // Two parties: the one that carries the ledger, and the boat/seller that
      // is only named on the line.
      const partyId = await findOrCreateParty(
        tx,
        d.partyName,
        "PURCHASE_GROUP"
      );
      const boatId = await findOrCreateParty(
        tx,
        d.boatName,
        PURCHASE_BOAT_TYPE[d.type]
      );
      const purchase = await tx.purchase.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          partyId,
          boatId,
          type: d.type,
          amount: d.amount,
          date: d.date,
          createdById: session.userId,
          lines: { create: d.lines },
        },
      });
      await postPurchaseLedger(tx, { ...purchase, ...d });
      await linkStagedAttachment(tx, staged, {
        companyId: company.id,
        centreId: centre.id,
        linkedType: "PURCHASE",
        linkedId: purchase.id,
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save purchase." };
  }

  revalidatePath("/vouchers/purchases");
  revalidatePath("/ledgers", "layout");
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
    const staged = await stageAttachmentFile(d.file);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.purchase.findUnique({ where: { id: purchaseId } });
      if (!existing) throw new Error("Purchase not found.");

      // Rebuilds the old party's statement too, in case this edit moves the
      // purchase to a different seller.
      await removeLedgerEntries(tx, {
        sourceId: purchaseId,
        sourceType: ["PURCHASE", "PAYMENT"],
      });
      await tx.purchaseLine.deleteMany({ where: { purchaseId } });

      const partyId = await findOrCreateParty(
        tx,
        d.partyName,
        "PURCHASE_GROUP"
      );
      const boatId = await findOrCreateParty(
        tx,
        d.boatName,
        PURCHASE_BOAT_TYPE[d.type]
      );
      const purchase = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          partyId,
          boatId,
          type: d.type,
          amount: d.amount,
          date: d.date,
          updatedById: session.userId,
          updatedAt: new Date(),
          lines: { create: d.lines },
        },
      });
      await postPurchaseLedger(tx, { ...purchase, ...d });
      // A newly chosen image replaces the old bill rather than piling up
      // beside it; leaving the field empty keeps whatever is attached.
      await replaceStagedAttachment(tx, staged, {
        companyId: existing.companyId,
        centreId: existing.centreId,
        linkedType: "PURCHASE",
        linkedId: purchaseId,
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save purchase." };
  }

  revalidatePath("/vouchers/purchases");
  revalidatePath("/ledgers", "layout");
  redirect("/vouchers/purchases");
}
