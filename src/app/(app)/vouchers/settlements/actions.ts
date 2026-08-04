"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { PartyType, SettlementKind, SettlementMode } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { requireActiveScope } from "@/lib/centre";
import { findOrCreateParty } from "@/lib/party-db";
import { postLedgerEntries, removeLedgerEntries } from "@/lib/ledger";
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
  const { company, centre } = await requireActiveScope();

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
  revalidatePath("/ledgers/parties");
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

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.settlement.findUnique({
        where: { id: settlementId },
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
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not save the voucher.",
    };
  }

  revalidatePath(SETTLEMENT_PATH[kind]);
  revalidatePath("/ledgers/parties");
  redirect(SETTLEMENT_PATH[kind]);
}
