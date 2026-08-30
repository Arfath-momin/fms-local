import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { uploadsRoot } from "@/lib/attachments";

/**
 * The company's identity for the top of a printed document.
 *
 * The PDFs were showing the company's short name where the HTML bill shows its
 * LOGO, its legal name, its address and its GSTIN. A bill without a GSTIN is
 * not a document a buyer can file, and a letterhead without the mark is a slip
 * of paper — so a PDF missing all four was a worse document than the page it
 * replaced.
 */
export type Letterhead = {
  name: string;
  legalName: string | null;
  address: string | null;
  /** Phone, email and GSTIN as one line, already joined. */
  contact: string | null;
  /** The mark itself, read off disk. Null when there is none, or none usable. */
  logo: { data: Buffer; format: "png" | "jpg" } | null;
};

/**
 * react-pdf draws PNG and JPEG and nothing else.
 *
 * The uploader also accepts WebP, which would throw inside the renderer and
 * fail the whole document rather than the picture — so an unusable mark is
 * treated as no mark, and the company's name stands in exactly as it does for a
 * company that never uploaded one. A bill that prints is worth more than a bill
 * that would have had a logo.
 */
function drawable(key: string): "png" | "jpg" | null {
  const ext = key.split(".").pop()?.toLowerCase();
  if (ext === "png") return "png";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  return null;
}

export async function letterheadFor(companyId: string): Promise<Letterhead> {
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      name: true,
      legalName: true,
      address: true,
      phone: true,
      email: true,
      gstin: true,
      logoKey: true,
    },
  });

  const contact = [
    c.phone && `Ph: ${c.phone}`,
    c.email,
    c.gstin && `GSTIN: ${c.gstin}`,
  ]
    .filter(Boolean)
    .join("   ·   ");

  let logo: Letterhead["logo"] = null;
  const format = c.logoKey ? drawable(c.logoKey) : null;
  if (c.logoKey && format) {
    // Resolved under the uploads root and checked to still be inside it, the
    // same guard the logo route uses: a key is data, and data that becomes a
    // file path is a way out of the directory if nobody stops it.
    const root = uploadsRoot();
    const file = path.resolve(root, c.logoKey);
    if (file.startsWith(path.resolve(root))) {
      try {
        logo = { data: await readFile(file), format };
      } catch {
        // Missing or unreadable file. A bill still has to print, so the name
        // stands in — the alternative is a 500 on every document because an
        // image was deleted off the disk.
        logo = null;
      }
    }
  }

  return {
    name: c.name,
    legalName: c.legalName,
    address: c.address,
    contact: contact || null,
    logo,
  };
}
