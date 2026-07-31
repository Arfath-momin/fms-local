import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import type { AttachmentLinkedType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

// Receipt/bill images live on the local filesystem — never in the DB, never in
// git. `storageKey` holds a path relative to the uploads root (for example
// "2026/07/<uuid>.jpg") rather than an absolute path, so the whole store can be
// moved, restored from backup, or rehosted without rewriting a single row.

/**
 * Root of the image store. In production point UPLOADS_DIR at a directory well
 * outside the build output (e.g. /var/lib/fms/uploads) so a redeploy cannot
 * take the client's bills with it.
 */
export function uploadsRoot(): string {
  // turbopackIgnore keeps the build tracer from concluding that an arbitrary
  // path may be read at runtime — without it, `output: "standalone"` copies the
  // entire project into the deploy bundle rather than just the traced files.
  const configured = process.env.UPLOADS_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return path.resolve(/* turbopackIgnore: true */ configured ?? "uploads");
}

/** Extensions we are willing to store, and the type we serve them back as. */
export const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The real format, read from the file's own leading bytes. The browser-supplied
 * `file.type` is attacker-controlled — trusting it would let someone store HTML
 * under a .png name and have us serve it back from our own origin. The sniffed
 * extension is what lands in the storage key, which in turn is what the
 * download route derives its Content-Type from.
 */
function sniffExtension(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return "png";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp";
  return null;
}

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
 * simply absent — bills are optional at entry and can be added later). This
 * only screens the declared type; the bytes are checked at write time.
 */
export function validateImageFile(file: unknown): string | null {
  if (!(file instanceof File) || file.size === 0) return null; // no file → fine
  if (!ALLOWED_IMAGE_TYPES[file.type])
    return "Only JPEG, PNG or WebP images can be attached.";
  if (file.size > MAX_UPLOAD_BYTES) return "Image is larger than 10 MB.";
  return null;
}

/**
 * Write an image under the uploads root and record it against a voucher.
 * Assumes validateImageFile() already passed. No-op when no file was provided.
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
  if (!ALLOWED_IMAGE_TYPES[file.type]) return;

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = sniffExtension(buffer);
  if (!ext) throw new Error("That file is not a JPEG, PNG or WebP image.");

  const id = uuid();
  const now = new Date();
  const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const storageKey = `${dir}/${id}.${ext}`;
  const root = uploadsRoot();

  // Date-sharded so no single directory accumulates every bill ever filed.
  // File first: an orphaned image is harmless, a row pointing at nothing is not.
  await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, storageKey), buffer);

  await prisma.attachment.create({
    data: {
      id,
      companyId: args.companyId,
      centreId: args.centreId,
      linkedType: args.linkedType,
      linkedId: args.linkedId,
      storageKey,
    },
  });
}
