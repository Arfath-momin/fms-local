import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { v4 as uuid } from "uuid";
import type { AttachmentLinkedType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

// Receipt/bill images live in Cloudinary — never in the DB, never in git.
// imageUrl stores the secure delivery URL Cloudinary returns on upload.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

/**
 * Cheap validation of an uploaded bill/receipt image before committing to
 * anything. Returns an error message, or null when the file is acceptable (or
 * simply absent — bills are optional at entry and can be added later).
 */
export function validateImageFile(file: unknown): string | null {
  if (!(file instanceof File) || file.size === 0) return null; // no file → fine
  if (!ALLOWED_IMAGE_TYPES[file.type])
    return "Only JPEG, PNG or WebP images can be attached.";
  if (file.size > MAX_UPLOAD_BYTES) return "Image is larger than 10 MB.";
  return null;
}

/**
 * Upload an image to Cloudinary and record it against a voucher. Assumes
 * validateImageFile() already passed. No-op when no file was provided.
 */
export async function saveAttachmentFile(args: {
  companyId: string;
  centreId: string;
  linkedType: AttachmentLinkedType;
  linkedId: string;
  file: unknown;
}): Promise<void> {
  const { file } = args;
  if (!(file instanceof File) || file.size === 0) return;
  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) return;

  const id = uuid();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { secure_url } = await new Promise<{ secure_url: string }>(
    (resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { public_id: id, folder: "fms-attachments", resource_type: "image" },
        (error, result) => {
          if (error || !result) reject(error ?? new Error("Cloudinary upload failed"));
          else resolve(result);
        }
      );
      stream.end(buffer);
    }
  );

  await prisma.attachment.create({
    data: {
      id,
      companyId: args.companyId,
      centreId: args.centreId,
      linkedType: args.linkedType,
      linkedId: args.linkedId,
      imageUrl: secure_url,
    },
  });
}
