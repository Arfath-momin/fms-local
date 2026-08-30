import Link from "next/link";

/**
 * What you can do with a voucher from its list, without opening it first.
 *
 * VIEW, not "Edit". This link has always gone to the voucher's own page — the
 * read-only one, with Edit as a button on it — but it was LABELLED "Edit" for
 * anyone who happened to have the right to edit. So the only way to look at a
 * bill appeared to be to start changing it, and a merchant checking a figure
 * had to open an edit screen and then be careful to leave without saving.
 *
 * PDF goes straight to the printable sheet, skipping the voucher page. Getting
 * a bill to send was a three-stop journey — list, voucher, Save as PDF — and it
 * is the thing this screen is most often opened to do.
 */
export function VoucherRowActions({
  viewHref,
  printHref,
}: {
  viewHref: string;
  /** Omitted where a voucher has no printable form, such as an expense. */
  printHref?: string;
}) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap text-[12px]">
      <Link
        href={viewHref}
        className="text-accent underline underline-offset-2"
      >
        View
      </Link>
      {printHref && (
        <>
          <span className="text-muted" aria-hidden="true">
            ·
          </span>
          {/* A plain <a> when the target is a generated FILE rather than a
              page. next/link client-navigates: it would fetch the PDF as an
              RSC payload, fail to parse it, and leave the row looking broken
              instead of downloading anything. */}
          {printHref.startsWith("/api/") ? (
            <a
              href={printHref}
              className="text-accent underline underline-offset-2"
            >
              PDF
            </a>
          ) : (
            <Link
              href={printHref}
              className="text-accent underline underline-offset-2"
            >
              PDF
            </Link>
          )}
        </>
      )}
    </span>
  );
}
