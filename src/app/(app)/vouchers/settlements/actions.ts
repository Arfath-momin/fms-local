"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { PartyType, SettlementKind, SettlementMode } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { getActiveScope, requireSubmittedScope } from "@/lib/centre";
import { findOrCreateParty } from "@/lib/party-db";
import { postLedgerEntries, removeLedgerEntries } from "@/lib/ledger";
import { resolveReviews } from "@/lib/review-db";
import {
  SETTLEMENT_LEDGER_TYPE,
  SETTLEMENT_MODES,
  SETTLEMENT_PARTY_TYPES,
  SETTLEMENT_PATH,
  SETTLEMENT_SOURCE_TYPE,
  isSettlementKind,
} from "@/lib/settlement";

export type SettlementFormState = { error: string } | null;

const DECIMAL2 = /^\d+(\.\d{1,2})?$/;

type Parsed = {
  partyName: string;
  partyType: PartyType;
  mode: SettlementMode;
  amount: Prisma.Decimal;
  date: Date;
  reference: string | null;
  notes: string | null;
};

const clean = (v: FormDataEntryValue | null) =>
  String(v ?? "").trim().replace(/\s+/g, " ");

function parse(
  kind: SettlementKind,
  formData: FormData
): { error: string } | { data: Parsed } {
  const partyName = clean(formData.get("partyName"));
  const partyTypeRaw = String(formData.get("partyType") ?? "");
  const modeRaw = String(formData.get("mode") ?? "") as SettlementMode;
  const amountRaw = clean(formData.get("amount"));
  const dateRaw = String(formData.get("date") ?? "");

  if (!partyName)
    return {
      error:
        kind === "PAYMENT"
          ? "Enter who was paid."
          : "Enter who the money was received from.",
    };

  const allowed = SETTLEMENT_PARTY_TYPES[kind];
  const partyType = allowed.includes(partyTypeRaw as PartyType)
    ? (partyTypeRaw as PartyType)
    : null;
  if (!partyType) return { error: "Choose what kind of party this is." };

  if (!SETTLEMENT_MODES.includes(modeRaw))
    return { error: "Choose how the money moved." };
  if (!DECIMAL2.test(amountRaw) || Number(amountRaw) <= 0)
    return { error: "Amount must be a positive number (up to 2 decimals)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };

  return {
    data: {
      partyName,
      partyType,
      mode: modeRaw,
      amount: new Prisma.Decimal(amountRaw),
      date: new Date(dateRaw),
      reference: clean(formData.get("reference")) || null,
      notes: clean(formData.get("notes")) || null,
    },
  };
}

export async function createSettlement(
  kind: SettlementKind,
  _prev: SettlementFormState,
  formData: FormData
): Promise<SettlementFormState> {
  const session = await requireEntry();
  if (!isSettlementKind(kind)) return { error: "Unknown voucher type." };

  const parsed = parse(kind, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const scoped = await requireSubmittedScope(formData);
  if ("error" in scoped) return { error: scoped.error };
  const { company, centre } = scoped.scope;

  try {
    await prisma.$transaction(async (tx) => {
      const partyId = await findOrCreateParty(tx, d.partyName, d.partyType);
      const settlement = await tx.settlement.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          partyId,
          kind,
          mode: d.mode,
          amount: d.amount,
          date: d.date,
          reference: d.reference,
          notes: d.notes,
          createdById: session.userId,
        },
      });
      // One entry, not an offsetting pair: the settlement *is* the movement.
      await postLedgerEntries(tx, [
        {
          companyId: company.id,
          centreId: centre.id,
          partyId,
          type: SETTLEMENT_LEDGER_TYPE[kind],
          sourceType: SETTLEMENT_SOURCE_TYPE[kind],
          sourceId: settlement.id,
          amount: d.amount,
          date: d.date,
        },
      ]);
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not save the voucher.",
    };
  }

  revalidatePath(SETTLEMENT_PATH[kind]);
  revalidatePath("/ledgers", "layout");
  redirect(SETTLEMENT_PATH[kind]);
}

/**
 * Delete a payment or receipt outright.
 *
 * `kind` is checked against the stored row rather than trusted: the two kinds
 * share this action and every view behind it, so a payment id arriving on the
 * receipts route must not delete anything. Removing the entry pushes the
 * party's balance back to what it owed before the money moved.
 */
export async function deleteSettlement(
  settlementId: string,
  kind: SettlementKind,
  _prev: SettlementFormState
): Promise<SettlementFormState> {
  const session = await requireAdmin();
  if (!isSettlementKind(kind)) return { error: "Unknown voucher type." };

  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.settlement.findFirst({
        // Scoped: an admin may only change or remove a voucher that belongs to
        // the company and centre they are currently working in.
        where: { id: settlementId, companyId: company.id, centreId: centre.id },
        select: { kind: true },
      });
      if (!existing || existing.kind !== kind)
        throw new Error("Voucher not found.");

      await removeLedgerEntries(tx, { sourceId: settlementId });
      // Removing the voucher answers any request against it. The request rows
      // themselves survive — they record that a correction was asked for.
      await resolveReviews(tx, kind, settlementId, session.userId);
      await tx.settlement.delete({ where: { id: settlementId } });
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not delete the voucher.",
    };
  }

  revalidatePath(SETTLEMENT_PATH[kind]);
  revalidatePath("/ledgers", "layout");
  revalidatePath("/dashboard");
  redirect(SETTLEMENT_PATH[kind]);
}

export async function updateSettlement(
  settlementId: string,
  kind: SettlementKind,
  _prev: SettlementFormState,
  formData: FormData
): Promise<SettlementFormState> {
  const session = await requireAdmin();
  if (!isSettlementKind(kind)) return { error: "Unknown voucher type." };

  const parsed = parse(kind, formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.settlement.findFirst({
        // Scoped: an admin may only change or remove a voucher that belongs to
        // the company and centre they are currently working in.
        where: { id: settlementId, companyId: company.id, centreId: centre.id },
        select: { companyId: true, centreId: true, kind: true },
      });
      if (!existing) throw new Error("Voucher not found.");

      // Rebuilds the previous party's statement too, so reassigning a payment
      // to a different supplier leaves neither ledger carrying a stale figure.
      await removeLedgerEntries(tx, { sourceId: settlementId });

      const partyId = await findOrCreateParty(tx, d.partyName, d.partyType);
      await tx.settlement.update({
        where: { id: settlementId },
        data: {
          partyId,
          mode: d.mode,
          amount: d.amount,
          date: d.date,
          reference: d.reference,
          notes: d.notes,
          updatedById: session.userId,
          updatedAt: new Date(),
        },
      });
      await postLedgerEntries(tx, [
        {
          companyId: existing.companyId,
          centreId: existing.centreId,
          partyId,
          type: SETTLEMENT_LEDGER_TYPE[existing.kind],
          sourceType: SETTLEMENT_SOURCE_TYPE[existing.kind],
          sourceId: settlementId,
          amount: d.amount,
          date: d.date,
        },
      ]);
      // The edit *is* the answer to any review request against this voucher, so
      // a successful save closes it. `existing.kind` rather than the argument:
      // the stored row is what the request was filed against. In the same
      // transaction — a save that rolls back leaves the request standing.
      await resolveReviews(tx, existing.kind, settlementId, session.userId);
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not save the voucher.",
    };
  }

  revalidatePath(SETTLEMENT_PATH[kind]);
  revalidatePath("/ledgers", "layout");
  revalidatePath("/dashboard");
  redirect(SETTLEMENT_PATH[kind]);
}
