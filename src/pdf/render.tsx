import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

/**
 * Turn a document into a downloadable response, one at a time.
 *
 * SERIALISED because the server has a single core shared with Postgres. Two
 * documents rendering at once would compete for it while somebody else is
 * trying to save a voucher; a bill takes well under a second, so a queue of two
 * or three is never felt. The chain survives a failed render rather than
 * jamming every document behind it.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/** A filename findable again in a folder of fifty, safe in a header and on disk. */
export function pdfFilename(...parts: (string | null | undefined)[]): string {
  return (
    parts
      .filter(Boolean)
      .join("-")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "document"
  );
}

export async function pdfResponse(
  doc: ReactElement<DocumentProps>,
  filename: string
): Promise<Response> {
  const buf = await serialise(() => renderToBuffer(doc));
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
      // A voucher can be corrected; a cached copy of the old one is worse than
      // a second's wait.
      "Cache-Control": "no-store",
    },
  });
}
