"use client";

/**
 * The on-screen controls above a printable voucher — never printed themselves.
 *
 * One button, labelled for the thing people actually want: a PDF to send. The
 * browser's print dialog IS the Save-as-PDF dialog, so this is the same action
 * either way — and with each page now setting its own document title (see
 * src/lib/doc-title.ts) the filename arrives pre-filled as the bill rather than
 * as "FMS".
 *
 * There was a "Plain (no colour)" checkbox here, remembered per browser in
 * localStorage. Every voucher prints black on white now, so it toggled between
 * plain and plain — a control that does nothing is worse than no control, since
 * a reader has to try it to find that out.
 */
export function PrintToolbar({
  backHref,
  backLabel,
}: {
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="no-print flex items-center justify-between gap-4 mb-4 flex-wrap">
      <a
        href={backHref}
        className="text-muted text-[13px] underline underline-offset-2"
      >
        ← {backLabel}
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
      >
        Save as PDF
      </button>
    </div>
  );
}
