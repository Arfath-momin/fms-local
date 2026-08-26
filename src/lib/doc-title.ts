/**
 * The name a printed document saves itself under.
 *
 * Every page inherited the root layout's title, "FMS", and a browser names a
 * "Save as PDF" file after `document.title` — so every bill, statement and
 * report the merchant saved landed in Downloads as FMS.pdf, then FMS(1).pdf,
 * and so on. A folder of those is not a filing system, and the one thing that
 * would have made them findable — which bill, whose statement, what date — was
 * the very thing being thrown away.
 *
 * So each printable page sets its own title from what the document actually is.
 * No PDF library is involved: the browser's own print dialog is where "Save as
 * PDF" lives, and the only thing it was missing was a sensible filename.
 *
 * Parts are joined with hyphens and stripped of anything a filesystem would
 * rather not see. Empty parts drop out, so a bill with no number simply gets a
 * shorter name instead of a stray double hyphen.
 */
export function docTitle(...parts: (string | null | undefined)[]): string {
  const cleaned = parts
    .map((p) => (p ?? "").trim())
    // Slashes, colons and quotes are the ones that actually break a save on
    // Windows or macOS; the rest is collapsed so a party called "S. K. Traders
    // & Co." does not produce a filename full of runs of punctuation.
    .map((p) => p.replace(/[\\/:*?"<>|]+/g, " "))
    .map((p) => p.replace(/[^\w\s.-]+/g, " "))
    .map((p) => p.replace(/\s+/g, "-"))
    .map((p) => p.replace(/-{2,}/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean);

  return cleaned.length > 0 ? cleaned.join("-") : "FMS";
}

/**
 * A date in the filename, as day-month-year to match every date on screen.
 *
 * Deliberately not ISO: the merchant reads these names in a Downloads folder,
 * and 24-08-2026 is the format the rest of the app has taught them. Takes the
 * already-formatted string rather than a Date so it cannot disagree with what
 * is printed on the document itself.
 */
export function titleDate(d: Date): string {
  // @db.Date values are UTC midnight; reading them in UTC preserves the day.
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${d.getUTCFullYear()}`;
}
