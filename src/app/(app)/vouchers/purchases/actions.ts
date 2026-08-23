"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { PurchaseType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  nextDocumentNo,
  purchaseSeriesPrefix,
} from "@/lib/document-series";
import { requireAdmin, requireEntry } from "@/lib/session";
import { getActiveScope, requireSubmittedScope } from "@/lib/centre";
import { FIXED_PURCHASE_PARTY, purchaseHasLineBoats } from "@/lib/party";
import { findOrCreateParty } from "@/lib/party-db";
import { postLedgerEntries, removeLedgerEntries } from "@/lib/ledger";
import { resolveReviews } from "@/lib/review-db";
import {
  linkStagedAttachment,
  replaceStagedAttachment,
  stageAttachmentFile,
  unlinkAttachments,
  validateImageFile,
} from "@/lib/attachments";

export type PurchaseFormState = { error: string } | null;

const PURCHASE_TYPES: PurchaseType[] = ["SOCIETY", "KFDC", "PRIVATE", "LOCAL"];

type ParsedLine = {
  /** Society / KFDC only; null on a Private or Local row. */
  boatName: string | null;
  particular: string;
  qtyKg: Prisma.Decimal;
  pricePerKg: Prisma.Decimal;
  total: Prisma.Decimal;
};

type Parsed = {
  type: PurchaseType;
  /** The ledger this purchase settles against. */
  partyName: string;
  billNo: string | null;
  /** Free-form remark. Posts to nothing; prints on the voucher. */
  notes: string | null;
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

/**
 * Every purchase type is itemised, and the grand total is always the sum of the
 * rows — never read from the form. A typed total could disagree with the lines
 * beneath it, and the ledger would then carry a figure the bill does not
 * support.
 */
function parse(formData: FormData): { error: string } | { data: Parsed } {
  const type = String(formData.get("type") ?? "") as PurchaseType;
  const dateRaw = String(formData.get("date") ?? "");
  const file = formData.get("bill");

  if (!PURCHASE_TYPES.includes(type))
    return { error: "Choose a purchase type." };

  // Society and KFDC settle against one standing account each, so the type
  // names the ledger. Private and Local buy from a different individual every
  // time, so the name is typed and that person carries their own ledger.
  const fixed = FIXED_PURCHASE_PARTY[type];
  const partyName = fixed ?? clean(formData.get("partyName"));
  if (!partyName) return { error: "Enter the name this bill is owed to." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };

  const badFile = validateImageFile(file);
  if (badFile) return { error: badFile };

  const billNo = clean(formData.get("billNo")) || null;
  const notes = clean(formData.get("notes")) || null;
  const date = new Date(dateRaw);
  // Only Society / KFDC rows carry a boat, so on the other two the field is not
  // rendered at all and getAll() returns an empty list that indexes to "".
  const wantsBoats = purchaseHasLineBoats(type);
  const boatNames = formData.getAll("boatName").map(String);
  const particulars = formData.getAll("particular").map(String);
  const qtys = formData.getAll("qtyKg").map(String);
  const prices = formData.getAll("pricePerKg").map(String);

  const lines: ParsedLine[] = [];
  for (let i = 0; i < particulars.length; i++) {
    const particular = particulars[i].trim().replace(/\s+/g, " ");
    const boatName = wantsBoats
      ? (boatNames[i] ?? "").trim().replace(/\s+/g, " ")
      : "";
    const qtyRaw = (qtys[i] ?? "").trim();
    const priceRaw = (prices[i] ?? "").trim();

    // Skip fully-blank rows the form may submit.
    if (!particular && !boatName && !qtyRaw && !priceRaw) continue;
    if (!particular) return { error: `Row ${i + 1} needs a particular.` };
    if (!DECIMAL3.test(qtyRaw) || Number(qtyRaw) <= 0)
      return {
        error: `Quantity for “${particular}” must be a positive number.`,
      };
    if (!DECIMAL2.test(priceRaw))
      return { error: `Rate for “${particular}” must be a number.` };

    const qtyKg = new Prisma.Decimal(qtyRaw);
    const pricePerKg = new Prisma.Decimal(priceRaw);
    lines.push({
      boatName: boatName || null,
      particular,
      qtyKg,
      pricePerKg,
      total: qtyKg.mul(pricePerKg),
    });
  }

  if (lines.length === 0) return { error: "Add at least one line item." };

  const amount = lines.reduce((a, l) => a.add(l.total), new Prisma.Decimal(0));
  if (amount.lessThanOrEqualTo(0))
    return { error: "The bill total must be more than zero." };

  return { data: { type, partyName, billNo, notes, amount, date, lines, file } };
}

/**
 * Resolve each row's boat to a Party, reusing one lookup per distinct name — a
 * six-row bill from one vessel does one round trip, not six.
 */
async function resolveLineBoats(
  tx: Prisma.TransactionClient,
  lines: ParsedLine[]
): Promise<(string | null)[]> {
  const ids = new Map<string, string>();
  const out: (string | null)[] = [];
  for (const l of lines) {
    if (!l.boatName) {
      out.push(null);
      continue;
    }
    let id = ids.get(l.boatName);
    if (!id) {
      id = await findOrCreateParty(tx, l.boatName, "BOAT");
      ids.set(l.boatName, id);
    }
    out.push(id);
  }
  return out;
}

/**
 * The number this purchase will carry.
 *
 * Issued inside the caller's transaction for Private and Local, so a failed
 * save rolls the number back rather than leaving a gap. Society and KFDC keep
 * the typed one — losing the society's own number would mean losing the
 * reference they quote back when there is a query.
 */
async function resolvePurchaseBillNo(
  tx: Prisma.TransactionClient,
  companyId: string,
  d: { type: PurchaseType; billNo: string | null }
): Promise<string | null> {
  const prefix = purchaseSeriesPrefix(d.type);
  if (!prefix) return d.billNo;
  // An edit keeps the number it was issued; only a new voucher takes one.
  return d.billNo ?? (await nextDocumentNo(tx, companyId, prefix));
}

/** The line rows to write, with each boat already resolved to an id. */
async function lineData(tx: Prisma.TransactionClient, lines: ParsedLine[]) {
  const boatIds = await resolveLineBoats(tx, lines);
  return lines.map((l, i) => ({
    // The line-level boat is the ONLY place a vessel is recorded now — the
    // header boat was deleted (spec §3.7) because one Society bill covers
    // several vessels.
    boatId: boatIds[i],
    particular: l.particular,
    qtyKg: l.qtyKg,
    pricePerKg: l.pricePerKg,
    total: l.total,
  }));
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
  const scoped = await requireSubmittedScope(formData);
  if ("error" in scoped) return { error: scoped.error };
  const { company, centre } = scoped.scope;

  try {
    // Staged before the transaction so a rejected image aborts the save
    // instead of leaving a purchase with no bill against it.
    const staged = await stageAttachmentFile(d.file);
    await prisma.$transaction(async (tx) => {
      // One party carries the ledger; the boats named on the rows are a name
      // registry and never get an entry of their own.
      // The purchase type is passed through so the seller is filed under the
      // kind of bill they appear on, which is what narrows the suggestions on
      // the next Private or Local entry.
      const partyId = await findOrCreateParty(
        tx,
        d.partyName,
        "PURCHASE_GROUP",
        d.type
      );
      const purchase = await tx.purchase.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          partyId,
          // Private and Local purchases have no supplier bill to copy a number
          // from, so BFM issues one. Society and KFDC bills arrive with the
          // society's own number and keep whatever was typed.
          billNo: await resolvePurchaseBillNo(tx, company.id, d),
          notes: d.notes,
          type: d.type,
          amount: d.amount,
          date: d.date,
          createdById: session.userId,
          lines: { create: await lineData(tx, d.lines) },
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
 * Delete a purchase outright.
 *
 * The ledger entries are removed *before* the row, so removeLedgerEntries can
 * read the scopes it has to repair while they still exist and rebuild the
 * seller's running balance from what is left — dropping the purchase first
 * would strand its CREDIT on a statement for a transaction that is gone.
 * Lines cascade with the row (see schema); the attachment rows are unlinked
 * explicitly and their image files stay on disk.
 */
export async function deletePurchase(
  purchaseId: string,
  _prev: PurchaseFormState
): Promise<PurchaseFormState> {
  const session = await requireAdmin();

  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.purchase.findFirst({
        // Scoped: an admin may only change or remove a voucher that belongs to
        // the company and centre they are currently working in.
        where: { id: purchaseId, companyId: company.id, centreId: centre.id },
        select: { id: true },
      });
      if (!existing) throw new Error("Purchase not found.");

      // No sourceType filter: nothing keyed to this voucher should outlive it.
      await removeLedgerEntries(tx, { sourceId: purchaseId });
      await unlinkAttachments(tx, "PURCHASE", purchaseId);
      // Removing the voucher answers any request against it. The request rows
      // themselves survive — they record that a correction was asked for.
      await resolveReviews(tx, "PURCHASE", purchaseId, session.userId);
      await tx.purchase.delete({ where: { id: purchaseId } });
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not delete purchase.",
    };
  }

  revalidatePath("/vouchers/purchases");
  revalidatePath("/ledgers", "layout");
  revalidatePath("/dashboard");
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

  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    const staged = await stageAttachmentFile(d.file);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.purchase.findFirst({
        where: { id: purchaseId, companyId: company.id, centreId: centre.id },
      });
      if (!existing) throw new Error("Purchase not found.");

      // Rebuilds the old party's statement too, in case this edit moves the
      // purchase to a different seller.
      await removeLedgerEntries(tx, {
        sourceId: purchaseId,
        sourceType: ["PURCHASE", "PAYMENT"],
      });
      await tx.purchaseLine.deleteMany({ where: { purchaseId } });

      // The purchase type is passed through so the seller is filed under the
      // kind of bill they appear on, which is what narrows the suggestions on
      // the next Private or Local entry.
      const partyId = await findOrCreateParty(
        tx,
        d.partyName,
        "PURCHASE_GROUP",
        d.type
      );
      const purchase = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          partyId,
          // An issued number is fixed — it identifies this voucher on paper
          // that may already have gone out. Only a Society or KFDC bill, whose
          // number is the society's, can be corrected here.
          billNo: await resolvePurchaseBillNo(tx, company.id, {
            type: d.type,
            billNo: d.billNo ?? existing.billNo,
          }),
          notes: d.notes,
          type: d.type,
          amount: d.amount,
          date: d.date,
          updatedById: session.userId,
          updatedAt: new Date(),
          lines: { create: await lineData(tx, d.lines) },
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
      // The edit *is* the answer to any review request against this purchase,
      // so a successful save closes it. In the same transaction: a save that
      // rolls back leaves the request standing.
      await resolveReviews(tx, "PURCHASE", purchaseId, session.userId);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save purchase." };
  }

  revalidatePath("/vouchers/purchases");
  revalidatePath("/ledgers", "layout");
  revalidatePath("/dashboard");
  redirect("/vouchers/purchases");
}
