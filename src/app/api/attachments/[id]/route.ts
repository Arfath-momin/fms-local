import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { CONTENT_TYPES, uploadsRoot } from "@/lib/attachments";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) return new NextResponse("Not found", { status: 404 });

  // Bill images sit on disk outside the public/ tree, so this route is the only
  // way to reach one and every read passes the auth gate above.
  const root = uploadsRoot();
  const file = path.resolve(root, attachment.storageKey);
  if (!file.startsWith(root + path.sep))
    return new NextResponse("Not found", { status: 404 });

  // Content-Type comes from the stored extension, which was derived from the
  // file's own magic bytes at upload — never from anything a client sent us.
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
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
