"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { SETTLEMENT_MODES } from "@/lib/settlement";
import type { SettlementMode } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { getActiveScope, requireSubmittedScope } from "@/lib/centre";
import { findOrCreateParty } from "@/lib/party-db";
import { reserveOutstandingFor, WITHHOLDING_LABELS } from "@/lib/reserve";
import type { WithholdingKind } from "@/generated/prisma/enums";

export type ReserveFormState = { error: string } | null;

const DECIMAL2 = /^\d+(\.\d{1,2})?$/;
const clean = (v: FormDataEntryValue | null) =>
  String(v ?? "").trim().replace(/\s+/g, " ");

type Parsed = {
  partyName: string;
  amount: Prisma.Decimal;
  date: Date;
  mode: SettlementMode;
  reference: string | null;
  notes: string | null;
};

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const partyName = clean(formData.get("partyName"));
  const amountRaw = clean(formData.get("amount"));
  const dateRaw = String(formData.get("date") ?? "");
  const modeRaw = clean(formData.get("mode"));
  const reference = clean(formData.get("reference"));
  const notes = clean(formData.get("notes"));

  if (!partyName) return { error: "Enter the market party." };
  if (!DECIMAL2.test(amountRaw) || Number(amountRaw) <= 0)
    return { error: "Amount must be a positive number (up to 2 decimals)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw))
    return { error: "Pick the date the money was collected." };
  if (!SETTLEMENT_MODES.includes(modeRaw as SettlementMode))
    return { error: "Choose how it was collected." };

  return {
    data: {
      partyName,
      amount: new Prisma.Decimal(amountRaw),
      date: new Date(dateRaw),
      mode: modeRaw as SettlementMode,
      reference: reference || null,
      notes: notes || null,
    },
  };
}

/**
 * Record reserve collected back from a market party.
 *
 * Deliberately NOT a settlement and NOT a ledger entry. Reserve never sat in
 * the trade ledger — it stays netted inside the market bill — so collecting it
 * settles nothing there and posting it would invent a debt that was never
 * recorded.
 *
 * What it does instead: clears that party's DERIVED reserve balance (sales
 * less collections), and is recognised as income in the net-profit tier on the
 * day it arrived. That date is the one in the system that is not a buying day.
 */
export async function createReserveCollection(
  _prev: ReserveFormState,
  formData: FormData
): Promise<ReserveFormState> {
  const session = await requireEntry();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  const scoped = await requireSubmittedScope(formData);
  if ("error" in scoped) return { error: scoped.error };
  const { company, centre } = scoped.scope;
  const scope = { companyId: company.id, centreId: centre.id };

  // Which of the two a market is handing over. They are separate balances, so
  // collecting cutting against the reserve figure would clear the wrong one and
  // leave both wrong.
  const kind: WithholdingKind =
    formData.get("kind") === "CUTTING" ? "CUTTING" : "RESERVE";
  const label = WITHHOLDING_LABELS[kind].toLowerCase();

  try {
    await prisma.$transaction(async (tx) => {
      const partyId = await findOrCreateParty(tx, d.partyName, "MARKET_BUYER");

      // Never collect more than was withheld. Overshooting would drive the
      // derived balance negative, which reads as the merchant owing money
      // back to a party who never had it withheld in the first place.
      const outstanding = await reserveOutstandingFor(scope, partyId, kind);
      if (d.amount.gt(outstanding)) {
        throw new Error(
          `${d.partyName} holds ${outstanding.toFixed(2)} of ${label}, so ` +
            `${d.amount.toFixed(2)} cannot be collected. Check the figure.`
        );
      }

      await tx.reserveCollection.create({
        data: {
          ...scope,
          kind,
          partyId,
          amount: d.amount,
          date: d.date,
          mode: d.mode,
          reference: d.reference,
          notes: d.notes,
          createdById: session.userId,
        },
      });
    });
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not record the collection.",
    };
  }

  revalidatePath("/ledgers/reserve");
  revalidatePath("/vouchers/reserve-collections");
  redirect(kind === "RESERVE" ? "/ledgers/reserve" : "/ledgers/reserve?kind=CUTTING");
}

/**
 * Remove a collection. Admin only, like every other voucher correction.
 *
 * Nothing to unpost: the derived balance simply goes back up by this amount
 * the moment the row is gone.
 */
export async function deleteReserveCollection(
  collectionId: string,
  _prev: ReserveFormState
): Promise<ReserveFormState> {
  await requireAdmin();
  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    const existing = await prisma.reserveCollection.findFirst({
      // Scoped: an admin may only remove a record belonging to the company and
      // centre they are working in.
      where: { id: collectionId, companyId: company.id, centreId: centre.id },
      select: { id: true },
    });
    if (!existing) return { error: "That collection no longer exists." };
    await prisma.reserveCollection.delete({ where: { id: collectionId } });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not remove the collection.",
    };
  }

  revalidatePath("/ledgers/reserve");
  return null;
}
