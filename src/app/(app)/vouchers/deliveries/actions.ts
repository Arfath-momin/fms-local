"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { DeliveryChannel } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { assertDayOpen } from "@/lib/dayclose";
import { postLedgerEntry } from "@/lib/ledger";
import { CHANNEL_BUYER_TYPE } from "@/lib/party";
import { findOrCreateParty } from "@/lib/party-db";
import { CHANNEL_LABELS } from "@/lib/delivery";
import { saveAttachmentFile, validateImageFile } from "@/lib/attachments";

export type DeliveryFormState = { error: string } | null;
export type SettlementFormState = { error: string } | null;

const CHANNELS: DeliveryChannel[] = ["MARKET", "FACTORY", "FISH_MILL", "LOCAL"];

// ---------- Delivery Note ----------

type ParsedDelivery = {
  channel: DeliveryChannel;
  buyerName: string; // empty → falls back to the channel label
  vehicleNo: string;
  date: Date;
  file: unknown;
};

function parseDelivery(
  formData: FormData
): { error: string } | { data: ParsedDelivery } {
  const channel = String(formData.get("channel") ?? "") as DeliveryChannel;
  const buyerName = String(formData.get("buyerName") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const vehicleNo = String(formData.get("vehicleNo") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const dateRaw = String(formData.get("date") ?? "");
  const file = formData.get("bill");

  if (!CHANNELS.includes(channel)) return { error: "Choose a type." };
  if (!vehicleNo) return { error: "Enter the vehicle number." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };

  const badFile = validateImageFile(file);
  if (badFile) return { error: badFile };

  return { data: { channel, buyerName, vehicleNo, date: new Date(dateRaw), file } };
}

async function resolveBuyer(
  tx: Prisma.TransactionClient,
  d: ParsedDelivery
): Promise<string> {
  const name = d.buyerName || CHANNEL_LABELS[d.channel];
  return findOrCreateParty(tx, name, CHANNEL_BUYER_TYPE[d.channel]);
}

export async function createDelivery(
  _prev: DeliveryFormState,
  formData: FormData
): Promise<DeliveryFormState> {
  await requireMerchant();
  const parsed = parseDelivery(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const company = await getActiveCompany();

  let noteId: string;
  try {
    noteId = await prisma.$transaction(async (tx) => {
      await assertDayOpen(tx, company.id, d.date);
      const partyId = await resolveBuyer(tx, d);
      const note = await tx.deliveryNote.create({
        data: {
          companyId: company.id,
          partyId,
          channel: d.channel,
          vehicleNo: d.vehicleNo,
          date: d.date,
        },
      });
      return note.id;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save delivery." };
  }

  await saveAttachmentFile({
    companyId: company.id,
    linkedType: "DELIVERY_NOTE",
    linkedId: noteId,
    file: d.file,
  });

  revalidatePath("/vouchers/deliveries");
  redirect(`/vouchers/deliveries/${noteId}`);
}

/** Edit is only allowed while PENDING (no settlements) on an open day. */
export async function updateDelivery(
  deliveryNoteId: string,
  _prev: DeliveryFormState,
  formData: FormData
): Promise<DeliveryFormState> {
  await requireMerchant();
  const parsed = parseDelivery(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  let companyId: string;
  try {
    companyId = await prisma.$transaction(async (tx) => {
      const existing = await tx.deliveryNote.findUnique({
        where: { id: deliveryNoteId },
        include: { _count: { select: { settlements: true } } },
      });
      if (!existing) throw new Error("Delivery note not found.");
      if (existing._count.settlements > 0)
        throw new Error("This delivery is already settled and cannot be edited.");
      await assertDayOpen(tx, existing.companyId, existing.date);
      await assertDayOpen(tx, existing.companyId, d.date);

      const partyId = await resolveBuyer(tx, d);
      await tx.deliveryNote.update({
        where: { id: deliveryNoteId },
        data: {
          partyId,
          channel: d.channel,
          vehicleNo: d.vehicleNo,
          date: d.date,
        },
      });
      return existing.companyId;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save delivery." };
  }

  await saveAttachmentFile({
    companyId,
    linkedType: "DELIVERY_NOTE",
    linkedId: deliveryNoteId,
    file: d.file,
  });

  revalidatePath("/vouchers/deliveries");
  redirect(`/vouchers/deliveries/${deliveryNoteId}`);
}

// ---------- Settlement ----------

/**
 * Settlement bill: records the Total Amount billed and recognises the full
 * sale in the buyer's ledger — DEBIT SALE for the total, matched by a CREDIT
 * PAYMENT for whatever's actually been received. Any shortfall stands as an
 * outstanding balance in the buyer ledger. Marks the delivery SETTLED.
 */
export async function createSettlement(
  deliveryNoteId: string,
  _prev: SettlementFormState,
  formData: FormData
): Promise<SettlementFormState> {
  await requireMerchant();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amountReceivedRaw = String(formData.get("amountReceived") ?? "").trim();
  const dateRaw = String(formData.get("date") ?? "");
  const file = formData.get("bill");

  if (!/^\d+(\.\d{1,2})?$/.test(amountRaw) || Number(amountRaw) <= 0)
    return { error: "Total amount must be a positive number (up to 2 decimals)." };
  if (!/^\d+(\.\d{1,2})?$/.test(amountReceivedRaw) || Number(amountReceivedRaw) < 0)
    return { error: "Amount received must be a number (up to 2 decimals)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };
  const badFile = validateImageFile(file);
  if (badFile) return { error: badFile };

  const amount = new Prisma.Decimal(amountRaw);
  const amountReceived = new Prisma.Decimal(amountReceivedRaw);
  if (amountReceived.gt(amount))
    return { error: "Amount received cannot exceed the total amount." };
  const date = new Date(dateRaw);

  let settlementId: string;
  let companyId: string;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const note = await tx.deliveryNote.findUnique({ where: { id: deliveryNoteId } });
      if (!note) throw new Error("Delivery note not found.");
      await assertDayOpen(tx, note.companyId, date);

      const settlement = await tx.settlement.create({
        data: { deliveryNoteId, amount, amountReceived, date },
      });
      await postLedgerEntry(tx, {
        companyId: note.companyId,
        partyId: note.partyId,
        type: "DEBIT",
        sourceType: "SALE",
        sourceId: settlement.id,
        amount,
        date,
      });
      if (amountReceived.gt(0)) {
        await postLedgerEntry(tx, {
          companyId: note.companyId,
          partyId: note.partyId,
          type: "CREDIT",
          sourceType: "PAYMENT",
          sourceId: settlement.id,
          amount: amountReceived,
          date,
        });
      }
      await tx.deliveryNote.update({
        where: { id: deliveryNoteId },
        data: { status: "SETTLED" },
      });
      return { settlementId: settlement.id, companyId: note.companyId };
    });
    settlementId = result.settlementId;
    companyId = result.companyId;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save settlement." };
  }

  await saveAttachmentFile({
    companyId,
    linkedType: "SETTLEMENT",
    linkedId: settlementId,
    file,
  });

  revalidatePath("/vouchers/deliveries");
  redirect(`/vouchers/deliveries/${deliveryNoteId}`);
}
