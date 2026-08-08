"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { requireActiveScope } from "@/lib/centre";
import { clearErrorFlag } from "@/lib/errorflag";
import {
  linkStagedAttachment,
  replaceStagedAttachment,
  stageAttachmentFile,
  unlinkAttachments,
  validateImageFile,
} from "@/lib/attachments";

export type DeliveryFormState = { error: string } | null;

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
  vehicleNo: string;
  advancePaid: Prisma.Decimal | null;
  driverName: string | null;
  mobileNo: string | null;
  lines: ParsedLine[];
  file: unknown;
};

const clean = (v: FormDataEntryValue | null) =>
  String(v ?? "").trim().replace(/\s+/g, " ");

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const billNo = clean(formData.get("billNo"));
  const dateRaw = String(formData.get("date") ?? "");
  const recipient = clean(formData.get("recipient"));
  const vehicleNo = clean(formData.get("vehicleNo"));
  const advanceRaw = clean(formData.get("advancePaid"));
  const driverName = clean(formData.get("driverName"));
  const mobileNo = clean(formData.get("mobileNo"));
  const file = formData.get("bill");

  if (!billNo) return { error: "Enter the bill number." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };
  if (!recipient) return { error: "Enter the recipient (To)." };
  if (!vehicleNo) return { error: "Enter the vehicle number." };

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

  return {
    data: {
      billNo,
      date: new Date(dateRaw),
      recipient,
      vehicleNo,
      advancePaid,
      driverName: driverName || null,
      mobileNo: mobileNo || null,
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
  const { company, centre } = await requireActiveScope();

  let noteId: string;
  try {
    // Staged before the write so a rejected image aborts the save instead of
    // leaving a delivery note with no bill against it.
    const staged = await stageAttachmentFile(d.file);
    noteId = await prisma.$transaction(async (tx) => {
      const note = await tx.deliveryNote.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          billNo: d.billNo,
          date: d.date,
          recipient: d.recipient,
          vehicleNo: d.vehicleNo,
          advancePaid: d.advancePaid,
          driverName: d.driverName,
          mobileNo: d.mobileNo,
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
  await requireAdmin();

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.deliveryNote.findUnique({
        where: { id: deliveryNoteId },
        select: { id: true },
      });
      if (!existing) throw new Error("Delivery note not found.");

      await unlinkAttachments(tx, "DELIVERY_NOTE", deliveryNoteId);
      await clearErrorFlag(tx, "DELIVERY_NOTE", deliveryNoteId);
      await tx.deliveryNote.delete({ where: { id: deliveryNoteId } });
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not delete delivery note.",
    };
  }

  revalidatePath("/vouchers/deliveries");
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

  try {
    const staged = await stageAttachmentFile(d.file);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.deliveryNote.findUnique({
        where: { id: deliveryNoteId },
        select: { companyId: true, centreId: true },
      });
      if (!existing) throw new Error("Delivery note not found.");

      await tx.deliveryNoteLine.deleteMany({ where: { deliveryNoteId } });
      await tx.deliveryNote.update({
        where: { id: deliveryNoteId },
        data: {
          billNo: d.billNo,
          date: d.date,
          recipient: d.recipient,
          vehicleNo: d.vehicleNo,
          advancePaid: d.advancePaid,
          driverName: d.driverName,
          mobileNo: d.mobileNo,
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
      // A newly chosen image replaces the old bill rather than piling up
      // beside it; leaving the field empty keeps whatever is attached.
      await replaceStagedAttachment(tx, staged, {
        companyId: existing.companyId,
        centreId: existing.centreId,
        linkedType: "DELIVERY_NOTE",
        linkedId: deliveryNoteId,
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save delivery note." };
  }

  revalidatePath("/vouchers/deliveries");
  redirect(`/vouchers/deliveries/${deliveryNoteId}`);
}
