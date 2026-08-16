import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { CONTENT_TYPES, uploadsRoot } from "@/lib/attachments";

/**
 * Serves a company's logo for the app header and the printed letterhead.
 *
 * A separate route from /api/attachments/[id] because a logo is not an
 * Attachment row — that model requires a centreId, and a logo belongs to the
 * company, not to one of its centres. The security handling is deliberately
 * identical: authenticated only, path-escape checked, and the Content-Type
 * derived from the stored extension, which was itself decided by sniffing the
 * file's magic bytes at upload rather than trusting anything a browser said.
 *
 * Not gated on company membership. A logo is letterhead — it is printed on
 * documents that leave the building — so it carries nothing a signed-in user of
 * another company should not see, and gating it would break the printed bill
 * for anyone whose grants change.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    select: { logoKey: true },
  });
  if (!company?.logoKey) return new NextResponse("Not found", { status: 404 });

  const root = uploadsRoot();
  const file = path.resolve(root, company.logoKey);
  if (!file.startsWith(root + path.sep))
    return new NextResponse("Not found", { status: 404 });

  const contentType = CONTENT_TYPES[path.extname(file).slice(1).toLowerCase()];
  if (!contentType) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await readFile(file);
  } catch {
    return new NextResponse("File missing", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
      // Longer than a bill image's hour: a logo changes almost never, and it is
      // fetched on every single page load.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
