"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { TripChannel } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { postLedgerEntries, removeLedgerEntries } from "@/lib/ledger";
import { requireAdmin, requireEntry } from "@/lib/session";
import { getActiveScope, requireSubmittedScope } from "@/lib/centre";
import { resolveReviews } from "@/lib/review-db";
import {
  linkStagedAttachment,
  replaceStagedAttachment,
  stageAttachmentFile,
  unlinkAttachments,
  validateImageFile,
} from "@/lib/attachments";

export type DeliveryFormState = { error: string } | null;

const TRIP_CHANNELS: TripChannel[] = [
  "MARKET",
  "FACTORY",
  "FISH_MILL",
  "LOCAL",
];

/**
 * The rent settlement chain for one trip (spec §2).
 *
 * Rent is a property of the TRIP, entered once and dated to the buying day.
 * It is credited to the transporter — we owe him — and the advance is debited
 * straight back, because that money has already left. What remains open is
 * exactly what is still unpaid, which is the signal the outstanding screen
 * exists to show. A market party paying the driver the balance closes the rest
 * later, through RENT_BY_PARTY on the sale that carries it.
 *
 * Deliberately NOT a separate rent expense voucher: that would be the second
 * rent expense, and the day would be charged twice.
 */
async function postTripRent(
  tx: Prisma.TransactionClient,
  t: {
    companyId: string;
    centreId: string;
    transporterId: string;
    id: string;
    rentAmount: Prisma.Decimal | null;
    advancePaid: Prisma.Decimal | null;
    date: Date;
    billNo: string;
  }
) {
  if (!t.rentAmount || t.rentAmount.lte(0)) return;

  const common = {
    companyId: t.companyId,
    centreId: t.centreId,
    partyId: t.transporterId,
    sourceId: t.id,
    date: t.date,
  };

  await postLedgerEntries(tx, [
    { ...common, type: "CREDIT" as const, sourceType: "RENT" as const, amount: t.rentAmount },
    ...(t.advancePaid && t.advancePaid.gt(0)
      ? [
          {
            ...common,
            type: "DEBIT" as const,
            sourceType: "PAYMENT" as const,
            amount: t.advancePaid,
          },
        ]
      : []),
  ]);

  // The rent is also a DIRECT cost of the buying day, and this is the ONLY
  // place it is expensed (spec §2, invariant 2). There is deliberately no rent
  // expense voucher: one would be the second charge for the same journey, and
  // the day would carry the cost twice.
  //
  // The expense carries no ledger entry of its own — the transporter is
  // already credited above, and posting again would double what he is owed.
  // Profit reads the expense table, not the ledger, so the cost still counts.
  const rentCategory = await tx.expenseCategory.findUnique({
    where: { companyId_code: { companyId: t.companyId, code: RENT_CATEGORY_CODE } },
    select: { id: true },
  });
  if (!rentCategory) {
    throw new Error(
      `No "${RENT_CATEGORY_CODE}" expense category exists for this company — ` +
        `add one under Masters before entering a trip with rent.`
    );
  }

  await tx.expense.create({
    data: {
      companyId: t.companyId,
      centreId: t.centreId,
      categoryId: rentCategory.id,
      partyId: t.transporterId,
      amount: t.rentAmount,
      date: t.date,
      spentOn: t.date,
      notes: `Vehicle rent for trip ${t.billNo}`,
      // Stamped so removeTripRent can find exactly this row again.
      details: { tripId: t.id },
    },
  });
}

/** The category code a trip's rent is filed under. */
const RENT_CATEGORY_CODE = "RENT";

/**
 * Remove a trip's rent expense, for the edit and delete paths.
 *
 * Matched on the tripId stamped into `details` rather than on amount + date,
 * which would also catch a hand-entered expense that happened to agree.
 */
async function removeTripRentExpense(
  tx: Prisma.TransactionClient,
  tripId: string
) {
  await tx.expense.deleteMany({
    where: { details: { path: ["tripId"], equals: tripId } },
  });
}

const DECIMAL2 = /^\d+(\.\d{1,2})?$/;
const DECIMAL3 = /^\d+(\.\d{1,3})?$/;
const INT = /^\d+$/;

type ParsedLine = {
  particulars: string;
  kg: Prisma.Decimal;
  box: number;
  bigBox: number;
  loose: number;
  pcs: number;
};

type Parsed = {
  billNo: string;
  date: Date;
  recipient: string;
  channel: TripChannel;
  vehicleId: string;
  rentAmount: Prisma.Decimal | null;
  advancePaid: Prisma.Decimal | null;
  driverName: string | null;
  mobileNo: string | null;
  /** Free-form remark. Posts to nothing; prints on the note. */
  notes: string | null;
  lines: ParsedLine[];
  file: unknown;
};

const clean = (v: FormDataEntryValue | null) =>
  String(v ?? "").trim().replace(/\s+/g, " ");

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const billNo = clean(formData.get("billNo"));
  const dateRaw = String(formData.get("date") ?? "");
  const recipient = clean(formData.get("recipient"));
  const channelRaw = clean(formData.get("channel"));
  const vehicleId = clean(formData.get("vehicleId"));
  const rentRaw = clean(formData.get("rentAmount"));
  const advanceRaw = clean(formData.get("advancePaid"));
  const driverName = clean(formData.get("driverName"));
  const mobileNo = clean(formData.get("mobileNo"));
  const notes = clean(formData.get("notes"));
  const file = formData.get("bill");

  if (!billNo) return { error: "Enter the bill number." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };
  if (!recipient) return { error: "Enter the recipient (To)." };
  if (!vehicleId) return { error: "Choose a vehicle." };
  if (!TRIP_CHANNELS.includes(channelRaw as TripChannel))
    return { error: "Choose a channel." };
  const channel = channelRaw as TripChannel;

  let rentAmount: Prisma.Decimal | null = null;
  if (rentRaw) {
    if (!DECIMAL2.test(rentRaw))
      return { error: "Rent must be a number (up to 2 decimals)." };
    rentAmount = new Prisma.Decimal(rentRaw);
  }

  let advancePaid: Prisma.Decimal | null = null;
  if (advanceRaw) {
    if (!DECIMAL2.test(advanceRaw))
      return { error: "Advance paid must be a number (up to 2 decimals)." };
    advancePaid = new Prisma.Decimal(advanceRaw);
  }

  const badFile = validateImageFile(file);
  if (badFile) return { error: badFile };

  const particulars = formData.getAll("particulars").map(String);
  const kgs = formData.getAll("kg").map(String);
  const boxes = formData.getAll("box").map(String);
  const bigBoxes = formData.getAll("bigBox").map(String);
  const looses = formData.getAll("loose").map(String);
  const pcses = formData.getAll("pcs").map(String);

  const intField = (raw: string, label: string): number | { error: string } => {
    const t = raw.trim();
    if (!t) return 0;
    if (!INT.test(t)) return { error: `${label} must be a whole number.` };
    return Number(t);
  };

  const lines: ParsedLine[] = [];
  for (let i = 0; i < particulars.length; i++) {
    const p = particulars[i].trim().replace(/\s+/g, " ");
    const kgRaw = (kgs[i] ?? "").trim();
    const boxRaw = (boxes[i] ?? "").trim();
    const bigRaw = (bigBoxes[i] ?? "").trim();
    const looseRaw = (looses[i] ?? "").trim();
    const pcsRaw = (pcses[i] ?? "").trim();

    // Skip fully-blank rows.
    if (!p && !kgRaw && !boxRaw && !bigRaw && !looseRaw && !pcsRaw) continue;
    if (!p) return { error: "Every line needs a particular." };

    let kg = new Prisma.Decimal(0);
    if (kgRaw) {
      if (!DECIMAL3.test(kgRaw))
        return { error: `Kg for “${p}” must be a number.` };
      kg = new Prisma.Decimal(kgRaw);
    }
    const box = intField(boxRaw, `Box for “${p}”`);
    if (typeof box === "object") return box;
    const bigBox = intField(bigRaw, `Big Box for “${p}”`);
    if (typeof bigBox === "object") return bigBox;
    const loose = intField(looseRaw, `Loose for “${p}”`);
    if (typeof loose === "object") return loose;
    const pcs = intField(pcsRaw, `Pcs for “${p}”`);
    if (typeof pcs === "object") return pcs;

    lines.push({ particulars: p, kg, box, bigBox, loose, pcs });
  }

  if (lines.length === 0) return { error: "Add at least one line item." };

  // Spec §4: only a market trip takes an advance. On every other channel BFM
  // pays the driver in full on his return, so an advance there is a data-entry
  // mistake that would leave the transporter's balance not closing at zero.
  if (advancePaid && advancePaid.gt(0) && channel !== "MARKET")
    return {
      error:
        "An advance is only paid on a market trip — on other channels the " +
        "driver is paid in full on his return.",
    };
  if (advancePaid && rentAmount && advancePaid.gt(rentAmount))
    return { error: "The advance cannot be more than the rent." };

  return {
    data: {
      billNo,
      date: new Date(dateRaw),
      recipient,
      channel,
      vehicleId,
      rentAmount,
      advancePaid,
      driverName: driverName || null,
      mobileNo: mobileNo || null,
      notes: notes || null,
      lines,
      file,
    },
  };
}

export async function createDelivery(
  _prev: DeliveryFormState,
  formData: FormData
): Promise<DeliveryFormState> {
  const session = await requireEntry();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const scoped = await requireSubmittedScope(formData);
  if ("error" in scoped) return { error: scoped.error };
  const { company, centre } = scoped.scope;

  let noteId: string;
  try {
    // Staged before the write so a rejected image aborts the save instead of
    // leaving a delivery note with no bill against it.
    const staged = await stageAttachmentFile(d.file);
    noteId = await prisma.$transaction(async (tx) => {
      // Scoped to the company and required live: a tampered form must not be
      // able to point this trip at another company's truck, or at one that was
      // archived precisely so it would stop being used.
      const vehicle = await tx.vehicle.findFirst({
        where: { id: d.vehicleId, companyId: company.id, archivedAt: null },
        select: { id: true, transporterId: true },
      });
      if (!vehicle) throw new Error("That vehicle is not available.");
      const note = await tx.deliveryNote.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          billNo: d.billNo,
          date: d.date,
          recipient: d.recipient,
          channel: d.channel,
          vehicleId: vehicle.id,
          rentAmount: d.rentAmount,
          advancePaid: d.advancePaid,
          driverName: d.driverName,
          mobileNo: d.mobileNo,
          notes: d.notes,
          createdById: session.userId,
          lines: {
            create: d.lines.map((l) => ({
              particulars: l.particulars,
              kg: l.kg,
              box: l.box,
              bigBox: l.bigBox,
              loose: l.loose,
              pcs: l.pcs,
            })),
          },
        },
      });
      await postTripRent(tx, {
        companyId: company.id,
        centreId: centre.id,
        transporterId: vehicle.transporterId,
        id: note.id,
        rentAmount: d.rentAmount,
        advancePaid: d.advancePaid,
        date: d.date,
        billNo: d.billNo,
      });

      await linkStagedAttachment(tx, staged, {
        companyId: company.id,
        centreId: centre.id,
        linkedType: "DELIVERY_NOTE",
        linkedId: note.id,
      });
      return note.id;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save delivery note." };
  }

  revalidatePath("/vouchers/deliveries");
  redirect(`/vouchers/deliveries/${noteId}`);
}

/**
 * Delete a delivery note outright.
 *
 * No ledger repair here, unlike every other voucher: a delivery note is a pure
 * dispatch record and never posted an entry, so there is nothing to rebuild.
 * Its lines cascade with the row.
 */
export async function deleteDelivery(
  deliveryNoteId: string,
  _prev: DeliveryFormState
): Promise<DeliveryFormState> {
  const session = await requireAdmin();

  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.deliveryNote.findFirst({
        // Scoped: an admin may only change or remove a voucher that belongs to
        // the company and centre they are currently working in.
        where: { id: deliveryNoteId, companyId: company.id, centreId: centre.id },
        select: { id: true },
      });
      if (!existing) throw new Error("Delivery note not found.");

      // The trip's rent entries go with it, and the transporter's chain is
      // repaired — otherwise deleting a trip would leave him permanently owed
      // rent for a journey that no longer exists.
      await removeLedgerEntries(tx, {
        sourceId: deliveryNoteId,
        sourceType: ["RENT", "PAYMENT"],
      });
      await removeTripRentExpense(tx, deliveryNoteId);
      await unlinkAttachments(tx, "DELIVERY_NOTE", deliveryNoteId);
      // Removing the voucher answers any request against it. The request rows
      // themselves survive — they record that a correction was asked for.
      await resolveReviews(tx, "DELIVERY_NOTE", deliveryNoteId, session.userId);
      await tx.deliveryNote.delete({ where: { id: deliveryNoteId } });
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not delete delivery note.",
    };
  }

  revalidatePath("/vouchers/deliveries");
  revalidatePath("/dashboard");
  redirect("/vouchers/deliveries");
}

export async function updateDelivery(
  deliveryNoteId: string,
  _prev: DeliveryFormState,
  formData: FormData
): Promise<DeliveryFormState> {
  const session = await requireAdmin();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    const staged = await stageAttachmentFile(d.file);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.deliveryNote.findFirst({
        // Scoped: an admin may only change or remove a voucher that belongs to
        // the company and centre they are currently working in.
        where: { id: deliveryNoteId, companyId: company.id, centreId: centre.id },
        select: { companyId: true, centreId: true, vehicleId: true },
      });
      if (!existing) throw new Error("Delivery note not found.");

      // Live vehicles, plus whichever one this trip already uses. Archiving a
      // truck means "stop choosing this on new trips", not "this trip can
      // never be corrected again" — and refusing here would leave an edit with
      // no valid option to pick.
      const updVehicle = await tx.vehicle.findFirst({
        where: {
          id: d.vehicleId,
          companyId: company.id,
          OR: [{ archivedAt: null }, { id: existing.vehicleId }],
        },
        select: { id: true, transporterId: true },
      });
      if (!updVehicle) throw new Error("That vehicle is not available.");

      // The rent chain is rebuilt, not patched: editing a trip can change the
      // rent, the advance or the truck, and each of those moves a different
      // transporter's balance. Removing what this trip posted and reposting is
      // the same discipline the voucher actions use for every other ledger.
      await removeLedgerEntries(tx, {
        sourceId: deliveryNoteId,
        sourceType: ["RENT", "PAYMENT"],
      });
      // ...and the rent expense it raised, or an edit that lowers the rent
      // would leave the day charged the old figure as well as the new one.
      await removeTripRentExpense(tx, deliveryNoteId);

      await tx.deliveryNoteLine.deleteMany({ where: { deliveryNoteId } });
      await tx.deliveryNote.update({
        where: { id: deliveryNoteId },
        data: {
          billNo: d.billNo,
          date: d.date,
          recipient: d.recipient,
          channel: d.channel,
          vehicleId: updVehicle.id,
          rentAmount: d.rentAmount,
          advancePaid: d.advancePaid,
          driverName: d.driverName,
          mobileNo: d.mobileNo,
          notes: d.notes,
          updatedById: session.userId,
          updatedAt: new Date(),
          lines: {
            create: d.lines.map((l) => ({
              particulars: l.particulars,
              kg: l.kg,
              box: l.box,
              bigBox: l.bigBox,
              loose: l.loose,
              pcs: l.pcs,
            })),
          },
        },
      });
      await postTripRent(tx, {
        companyId: company.id,
        centreId: centre.id,
        transporterId: updVehicle.transporterId,
        id: deliveryNoteId,
        rentAmount: d.rentAmount,
        advancePaid: d.advancePaid,
        date: d.date,
        billNo: d.billNo,
      });

      // A newly chosen image replaces the old bill rather than piling up
      // beside it; leaving the field empty keeps whatever is attached.
      await replaceStagedAttachment(tx, staged, {
        companyId: existing.companyId,
        centreId: existing.centreId,
        linkedType: "DELIVERY_NOTE",
        linkedId: deliveryNoteId,
      });
      // The edit *is* the answer to any review request against this note, so a
      // successful save closes it. In the same transaction: a save that rolls
      // back leaves the request standing.
      await resolveReviews(tx, "DELIVERY_NOTE", deliveryNoteId, session.userId);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save delivery note." };
  }

  revalidatePath("/vouchers/deliveries");
  revalidatePath("/dashboard");
  redirect(`/vouchers/deliveries/${deliveryNoteId}`);
}
