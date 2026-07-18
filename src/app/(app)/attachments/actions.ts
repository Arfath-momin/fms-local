"use server";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { v4 as uuid } from "uuid";
import type { AttachmentLinkedType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/session";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOADS_DIR,
} from "@/lib/attachments";

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

  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext)
    return { error: "Only JPEG, PNG or WebP images can be attached." };
  if (file.size > MAX_UPLOAD_BYTES)
    return { error: "Image is larger than 10 MB." };

  const id = uuid();
  const filename = `${id}.${ext}`;
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(
    path.join(UPLOADS_DIR, filename),
    Buffer.from(await file.arrayBuffer())
  );

  await prisma.attachment.create({
    data: { id, companyId, linkedType, linkedId, imageUrl: filename },
  });

  revalidatePath(revalidate);
  return null;
}
