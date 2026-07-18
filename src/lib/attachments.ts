import "server-only";
import path from "node:path";
import type { AttachmentLinkedType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

// Receipt/bill images live on local disk (spec §1) — never in the DB, never
// in git. Filename is the attachment id + extension.
export const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export async function getAttachments(
  linkedType: AttachmentLinkedType,
  linkedId: string
) {
  return prisma.attachment.findMany({
    where: { linkedType, linkedId },
    orderBy: { uploadedAt: "asc" },
  });
}
