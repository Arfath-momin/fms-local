"use client";

/**
 * Opens the browser's print dialog, which is also where "Save as PDF" lives —
 * so one button covers both printing the bill and producing a file to send.
 *
 * A client component purely for the onClick; everything it prints was rendered
 * on the server.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
    >
      Print / Save as PDF
    </button>
  );
}
