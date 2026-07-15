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
import { getNetQty, postStockMovement } from "@/lib/stock";
import { getSettledTotals, postOwnerReserveEntry } from "@/lib/delivery";

export type DeliveryFormState = { error: string } | null;
export type SettlementFormState = { error: string } | null;

const CHANNELS: DeliveryChannel[] = [
  "FACTORY",
  "MARKET",
  "FISH_MILL",
  "LOCAL_SALE",
];

// ---------- Delivery Note ----------

type ParsedDelivery = {
  channel: DeliveryChannel;
  partyId: string;
  fishType: string;
  qtySent: Prisma.Decimal;
  rate: Prisma.Decimal;
  date: Date;
};

function parseDelivery(
  formData: FormData
): { error: string } | { data: ParsedDelivery } {
  const channel = String(formData.get("channel") ?? "") as DeliveryChannel;
  const partyId = String(formData.get("partyId") ?? "");
  const fishType = String(formData.get("fishType") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const qtyRaw = String(formData.get("qtySent") ?? "").trim();
  const rateRaw = String(formData.get("rate") ?? "").trim();
  const dateRaw = String(formData.get("date") ?? "");

  if (!CHANNELS.includes(channel)) return { error: "Choose a channel." };
  if (!partyId) return { error: "Choose a buyer." };
  if (!fishType) return { error: "Choose a fish type." };
  if (!/^\d+(\.\d{1,3})?$/.test(qtyRaw) || Number(qtyRaw) <= 0)
    return { error: "Quantity must be a positive number (up to 3 decimals)." };
  if (!/^\d+(\.\d{1,2})?$/.test(rateRaw) || Number(rateRaw) <= 0)
    return { error: "Rate must be a positive number (up to 2 decimals)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };

  return {
    data: {
      channel,
      partyId,
      fishType,
      qtySent: new Prisma.Decimal(qtyRaw),
      rate: new Prisma.Decimal(rateRaw),
      date: new Date(dateRaw),
    },
  };
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

  let noteId = "";
  try {
    await prisma.$transaction(async (tx) => {
      await assertDayOpen(tx, company.id, d.date);

      const available = await getNetQty(tx, company.id, d.fishType, "AVAILABLE");
      if (available.lessThan(d.qtySent)) {
        throw new Error(
          `Only ${available.toString()} kg of ${d.fishType} is available — cannot dispatch ${d.qtySent.toString()} kg.`
        );
      }

      const note = await tx.deliveryNote.create({
        data: {
          companyId: company.id,
          partyId: d.partyId,
          channel: d.channel,
          fishType: d.fishType,
          qtySent: d.qtySent,
          rate: d.rate, // locked here — settlement never renegotiates price (spec §3.2)
          expectedValue: d.qtySent.mul(d.rate),
          date: d.date,
        },
      });
      noteId = note.id;

      // AVAILABLE → IN_TRANSIT as an out/in pair
      await postStockMovement(tx, {
        companyId: company.id,
        fishType: d.fishType,
        qtyKg: d.qtySent,
        direction: "OUT",
        state: "AVAILABLE",
        sourceType: "DELIVERY",
        sourceId: note.id,
        date: d.date,
      });
      await postStockMovement(tx, {
        companyId: company.id,
        fishType: d.fishType,
        qtyKg: d.qtySent,
        direction: "IN",
        state: "IN_TRANSIT",
        sourceType: "DELIVERY",
        sourceId: note.id,
        date: d.date,
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save delivery." };
  }

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

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.deliveryNote.findUnique({
        where: { id: deliveryNoteId },
        include: { _count: { select: { settlements: true } } },
      });
      if (!existing) throw new Error("Delivery note not found.");
      if (existing._count.settlements > 0)
        throw new Error(
          "This delivery already has settlements and can no longer be edited."
        );

      await assertDayOpen(tx, existing.companyId, existing.date);
      await assertDayOpen(tx, existing.companyId, d.date);

      await tx.stockMovement.deleteMany({
        where: { sourceType: "DELIVERY", sourceId: deliveryNoteId },
      });

      const note = await tx.deliveryNote.update({
        where: { id: deliveryNoteId },
        data: {
          partyId: d.partyId,
          channel: d.channel,
          fishType: d.fishType,
          qtySent: d.qtySent,
          rate: d.rate,
          expectedValue: d.qtySent.mul(d.rate),
          date: d.date,
        },
      });

      await postStockMovement(tx, {
        companyId: note.companyId,
        fishType: d.fishType,
        qtyKg: d.qtySent,
        direction: "OUT",
        state: "AVAILABLE",
        sourceType: "DELIVERY",
        sourceId: note.id,
        date: d.date,
      });
      await postStockMovement(tx, {
        companyId: note.companyId,
        fishType: d.fishType,
        qtyKg: d.qtySent,
        direction: "IN",
        state: "IN_TRANSIT",
        sourceType: "DELIVERY",
        sourceId: note.id,
        date: d.date,
      });

      for (const fishType of new Set([existing.fishType, d.fishType])) {
        const net = await getNetQty(tx, note.companyId, fishType, "AVAILABLE");
        if (net.isNegative()) {
          throw new Error(
            `Cannot save: available stock of ${fishType} would go negative.`
          );
        }
      }
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save delivery." };
  }

  revalidatePath("/vouchers/deliveries");
  redirect(`/vouchers/deliveries/${deliveryNoteId}`);
}

// ---------- Settlement ----------

type ParsedSettlement = {
  qtyAccepted: Prisma.Decimal;
  qtyReturned: Prisma.Decimal;
  qtySpoiled: Prisma.Decimal;
  amountReceived: Prisma.Decimal;
  gross: Prisma.Decimal | null;
  commission: Prisma.Decimal | null;
  ownerReserve: Prisma.Decimal | null;
  date: Date;
};

function decOrNull(raw: string): Prisma.Decimal | null | "bad" {
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return "bad";
  return new Prisma.Decimal(raw);
}

function parseSettlement(
  formData: FormData
): { error: string } | { data: ParsedSettlement } {
  const qty = (name: string) => String(formData.get(name) ?? "0").trim() || "0";
  const qtys: Record<string, Prisma.Decimal> = {};
  for (const name of ["qtyAccepted", "qtyReturned", "qtySpoiled"]) {
    const raw = qty(name);
    if (!/^\d+(\.\d{1,3})?$/.test(raw))
      return { error: "Quantities must be numbers (up to 3 decimals)." };
    qtys[name] = new Prisma.Decimal(raw);
  }

  const amountRaw = String(formData.get("amountReceived") ?? "").trim() || "0";
  if (!/^\d+(\.\d{1,2})?$/.test(amountRaw))
    return { error: "Amount received must be a number (up to 2 decimals)." };

  const gross = decOrNull(String(formData.get("gross") ?? "").trim());
  const commission = decOrNull(String(formData.get("commission") ?? "").trim());
  const ownerReserve = decOrNull(
    String(formData.get("ownerReserve") ?? "").trim()
  );
  if (gross === "bad" || commission === "bad" || ownerReserve === "bad")
    return { error: "Deduction fields must be numbers (up to 2 decimals)." };

  const dateRaw = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };

  return {
    data: {
      qtyAccepted: qtys.qtyAccepted,
      qtyReturned: qtys.qtyReturned,
      qtySpoiled: qtys.qtySpoiled,
      amountReceived: new Prisma.Decimal(amountRaw),
      gross,
      commission,
      ownerReserve,
      date: new Date(dateRaw),
    },
  };
}

/**
 * Settlement posting (spec §2 Settlement):
 *  - accepted → SOLD, returned → AVAILABLE, spoiled → LOSS (permanent)
 *  - ledger: DEBIT SALE at the locked rate for accepted qty; CREDIT what the
 *    buyer actually put toward the sale (gross when billed, else net);
 *    any shortfall is labeled as PRICE_VARIANCE debt so it stays visible on
 *    the party's statement (spec §2 price variance, §5).
 *  - a non-zero owner reserve credits the company's reserve account.
 */
export async function createSettlement(
  deliveryNoteId: string,
  _prev: SettlementFormState,
  formData: FormData
): Promise<SettlementFormState> {
  await requireMerchant();
  const parsed = parseSettlement(formData);
  if ("error" in parsed) return { error: parsed.error };
  const s = parsed.data;

  const settledQty = s.qtyAccepted.add(s.qtyReturned).add(s.qtySpoiled);
  if (settledQty.lessThanOrEqualTo(0))
    return { error: "Enter at least one non-zero quantity." };

  try {
    await prisma.$transaction(async (tx) => {
      const note = await tx.deliveryNote.findUnique({
        where: { id: deliveryNoteId },
      });
      if (!note) throw new Error("Delivery note not found.");
      if (note.status === "SETTLED")
        throw new Error("This delivery note is already fully settled.");

      await assertDayOpen(tx, note.companyId, s.date);

      const prior = await getSettledTotals(tx, deliveryNoteId);
      const remaining = note.qtySent.sub(prior.total);
      if (settledQty.greaterThan(remaining)) {
        throw new Error(
          `Accepted + Returned + Spoiled must not exceed the ${remaining.toString()} kg still unsettled — currently totals ${settledQty.toString()} kg.`
        );
      }

      const settlement = await tx.settlement.create({
        data: {
          deliveryNoteId,
          qtyAccepted: s.qtyAccepted,
          qtyReturned: s.qtyReturned,
          qtySpoiled: s.qtySpoiled,
          amountReceived: s.amountReceived,
          gross: s.gross,
          commission: s.commission,
          ownerReserve: s.ownerReserve,
          date: s.date,
        },
      });

      // Stock transitions — all out of IN_TRANSIT
      const stockPairs: {
        qty: Prisma.Decimal;
        toState: "SOLD" | "AVAILABLE" | "LOSS";
        sourceType: "SETTLEMENT" | "SETTLEMENT_RETURN" | "LOSS_WRITEOFF";
      }[] = [
        { qty: s.qtyAccepted, toState: "SOLD", sourceType: "SETTLEMENT" },
        { qty: s.qtyReturned, toState: "AVAILABLE", sourceType: "SETTLEMENT_RETURN" },
        { qty: s.qtySpoiled, toState: "LOSS", sourceType: "LOSS_WRITEOFF" },
      ];
      for (const p of stockPairs) {
        if (p.qty.lessThanOrEqualTo(0)) continue;
        await postStockMovement(tx, {
          companyId: note.companyId,
          fishType: note.fishType,
          qtyKg: p.qty,
          direction: "OUT",
          state: "IN_TRANSIT",
          sourceType: p.sourceType,
          sourceId: settlement.id,
          date: s.date,
        });
        await postStockMovement(tx, {
          companyId: note.companyId,
          fishType: note.fishType,
          qtyKg: p.qty,
          direction: "IN",
          state: p.toState,
          sourceType: p.sourceType,
          sourceId: settlement.id,
          date: s.date,
        });
      }

      // Ledger
      const expected = s.qtyAccepted.mul(note.rate);
      const paidTowardSale = s.gross ?? s.amountReceived;
      if (expected.greaterThan(0)) {
        await postLedgerEntry(tx, {
          companyId: note.companyId,
          partyId: note.partyId,
          type: "DEBIT",
          sourceType: "SALE",
          sourceId: settlement.id,
          amount: expected,
          date: s.date,
        });
      }
      const shortfall = expected.sub(paidTowardSale);
      if (shortfall.greaterThan(0)) {
        // Credit the full expected value, then re-debit the shortfall as an
        // explicit PRICE_VARIANCE line so the debt is visible, not buried.
        await postLedgerEntry(tx, {
          companyId: note.companyId,
          partyId: note.partyId,
          type: "CREDIT",
          sourceType: "SETTLEMENT",
          sourceId: settlement.id,
          amount: expected,
          date: s.date,
        });
        await postLedgerEntry(tx, {
          companyId: note.companyId,
          partyId: note.partyId,
          type: "DEBIT",
          sourceType: "PRICE_VARIANCE",
          sourceId: settlement.id,
          amount: shortfall,
          date: s.date,
        });
      } else if (paidTowardSale.greaterThan(0)) {
        await postLedgerEntry(tx, {
          companyId: note.companyId,
          partyId: note.partyId,
          type: "CREDIT",
          sourceType: "SETTLEMENT",
          sourceId: settlement.id,
          amount: paidTowardSale,
          date: s.date,
        });
      }

      if (s.ownerReserve && s.ownerReserve.greaterThan(0)) {
        await postOwnerReserveEntry(tx, {
          companyId: note.companyId,
          settlementId: settlement.id,
          amount: s.ownerReserve,
          date: s.date,
        });
      }

      // Status
      const after = await getSettledTotals(tx, deliveryNoteId);
      await tx.deliveryNote.update({
        where: { id: deliveryNoteId },
        data: {
          status: after.total.equals(note.qtySent)
            ? "SETTLED"
            : "PARTIALLY_SETTLED",
        },
      });
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not save settlement.",
    };
  }

  revalidatePath("/vouchers/deliveries");
  redirect(`/vouchers/deliveries/${deliveryNoteId}`);
}
