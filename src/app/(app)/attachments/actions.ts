"use server";

import { revalidatePath } from "next/cache";
import type { AttachmentLinkedType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireEntry } from "@/lib/session";
import { linkStagedAttachment, stageAttachmentFile, validateImageFile } from "@/lib/attachments";

export type UploadState = { error: string } | null;

const LINKED_TYPES: AttachmentLinkedType[] = [
  "PURCHASE",
  "DELIVERY_NOTE",
  "SALE",
  "EXPENSE",
];

/**
 * The (company, centre) an attachment belongs to is derived from the linked
 * record itself — never trusted from the client — so the attachment always
 * lands in the same scope as the voucher it documents.
 */
async function scopeForLinked(
  linkedType: AttachmentLinkedType,
  linkedId: string
): Promise<{ companyId: string; centreId: string } | null> {
  const select = { companyId: true, centreId: true } as const;
  switch (linkedType) {
    case "PURCHASE":
      return prisma.purchase.findUnique({ where: { id: linkedId }, select });
    case "EXPENSE":
      return prisma.expense.findUnique({ where: { id: linkedId }, select });
    case "DELIVERY_NOTE":
      return prisma.deliveryNote.findUnique({ where: { id: linkedId }, select });
    case "SALE":
      return prisma.sale.findUnique({ where: { id: linkedId }, select });
    default:
      return null;
  }
}

export async function uploadAttachment(
  linkedType: AttachmentLinkedType,
  linkedId: string,
  revalidate: string,
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  await requireEntry();
  if (!LINKED_TYPES.includes(linkedType))
    return { error: "Unsupported attachment target." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { error: "Choose an image file." };

  const invalid = validateImageFile(file);
  if (invalid) return { error: invalid };

  const scope = await scopeForLinked(linkedType, linkedId);
  if (!scope) return { error: "Could not find the record to attach to." };

  // Here the voucher already exists, so staging and linking happen back to
  // back; the error is surfaced rather than swallowed, which is what used to
  // make a failed upload look like a successful one.
  try {
    const staged = await stageAttachmentFile(file);
    await prisma.$transaction((tx) =>
      linkStagedAttachment(tx, staged, {
        companyId: scope.companyId,
        centreId: scope.centreId,
        linkedType,
        linkedId,
      })
    );
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not attach that image.",
    };
  }

  revalidatePath(revalidate);
  return null;
}
