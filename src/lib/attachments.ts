import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import type { Prisma } from "@/generated/prisma/client";
import type { AttachmentLinkedType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
} from "@/lib/attachment-limits";

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

// Re-exported so server code keeps importing limits from one place, while the
// client picker imports the same values from the isomorphic module.
export { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES };

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

/** An image already written to disk, not yet linked to a voucher. */
export type StagedAttachment = { id: string; storageKey: string };

/**
 * Validate an uploaded image and write its bytes to the store, returning the
 * key to link once the voucher is known. Returns null when no file was
 * supplied — bills are optional.
 *
 * Callers must run this *before* opening the transaction that writes the
 * voucher. Uploading afterwards, which is what this code used to do, meant a
 * rejected image still left a saved voucher behind with no bill against it and
 * nothing shown to the user. Staging first inverts that: a bad image fails the
 * save outright, and the only failure left is an orphaned file, which is
 * harmless and invisible.
 *
 * Throws — rather than silently skipping, the previous behaviour — when the
 * bytes are not actually an image, so the caller reports it instead of
 * pretending the upload worked.
 */
export async function stageAttachmentFile(
  file: unknown
): Promise<StagedAttachment | null> {
  if (!(file instanceof File) || file.size === 0) return null;

  const declared = validateImageFile(file);
  if (declared) throw new Error(declared);

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = sniffExtension(buffer);
  if (!ext) throw new Error("That file is not a JPEG, PNG or WebP image.");

  const id = uuid();
  const now = new Date();
  const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const storageKey = `${dir}/${id}.${ext}`;
  const root = uploadsRoot();

  // Date-sharded so no single directory accumulates every bill ever filed.
  await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, storageKey), buffer);

  return { id, storageKey };
}

type LinkArgs = {
  companyId: string;
  centreId: string;
  linkedType: AttachmentLinkedType;
  linkedId: string;
};

/**
 * Link a staged image to its voucher. Runs inside the voucher's transaction,
 * so the row and the voucher commit or roll back together.
 */
export async function linkStagedAttachment(
  tx: Prisma.TransactionClient,
  staged: StagedAttachment | null,
  args: LinkArgs
): Promise<void> {
  if (!staged) return;
  await tx.attachment.create({
    data: {
      id: staged.id,
      companyId: args.companyId,
      centreId: args.centreId,
      linkedType: args.linkedType,
      linkedId: args.linkedId,
      storageKey: staged.storageKey,
    },
  });
}

/**
 * Replace a voucher's bill image on edit.
 *
 * Re-submitting the form with a new file used to *append* a second image, so a
 * corrected bill left the wrong one on the record alongside it. Editing with
 * the file field left empty keeps whatever is already attached, because the
 * browser cannot round-trip an existing file into the input.
 *
 * The old rows go, but their files stay on disk: an unreferenced image costs
 * nothing, while deleting the bytes would make the change unrecoverable if the
 * edit itself is later rolled back.
 */
export async function replaceStagedAttachment(
  tx: Prisma.TransactionClient,
  staged: StagedAttachment | null,
  args: LinkArgs
): Promise<void> {
  if (!staged) return;
  await tx.attachment.deleteMany({
    where: { linkedType: args.linkedType, linkedId: args.linkedId },
  });
  await linkStagedAttachment(tx, staged, args);
}
