"use server";

import { revalidatePath } from "next/cache";
import type { AttachmentLinkedType } from "@/generated/prisma/enums";
import { requireMerchant } from "@/lib/session";
import { saveAttachmentFile, validateImageFile } from "@/lib/attachments";

export type UploadState = { error: string } | null;

const LINKED_TYPES: AttachmentLinkedType[] = [
  "PURCHASE",
  "DELIVERY_NOTE",
  "SETTLEMENT",
  "EXPENSE",
];

export async function uploadAttachment(
  linkedType: AttachmentLinkedType,
  linkedId: string,
  companyId: string,
  revalidate: string,
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  await requireMerchant();
  if (!LINKED_TYPES.includes(linkedType))
    return { error: "Unsupported attachment target." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { error: "Choose an image file." };

  const invalid = validateImageFile(file);
  if (invalid) return { error: invalid };

  await saveAttachmentFile({ companyId, linkedType, linkedId, file });

  revalidatePath(revalidate);
  return null;
}
