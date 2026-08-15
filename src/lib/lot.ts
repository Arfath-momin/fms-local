import type { Lot } from "@/generated/prisma/client";

/** The code every centre's standing overhead lot carries. */
export const OVERHEAD_LOT_CODE = "GENERAL";

/** What the overhead lot is called on screen. */
export const OVERHEAD_LOT_LABEL = "General (overheads)";

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/**
 * The code for a consignment opened on a given day — "15AUG26".
 *
 * Built from the date rather than a counter so it is recognisable on sight: the
 * merchant knows which fish "15AUG26" means without looking it up, which is
 * what makes picking one on a sale form a half-second decision. The year is in
 * there because a lot from last August must not collide with this one.
 *
 * Dates are read in UTC because they come from @db.Date columns, which are
 * stored as UTC midnight (see src/lib/format.ts).
 */
export function lotCodeFor(openedOn: Date, sequence = 1): string {
  const dd = String(openedOn.getUTCDate()).padStart(2, "0");
  const mmm = MONTHS[openedOn.getUTCMonth()];
  const yy = String(openedOn.getUTCFullYear()).slice(2);
  const base = `${dd}${mmm}${yy}`;
  // A second lot on one day is not part of the normal flow, but the suffix
  // means the unique constraint can never wedge a purchase that needs saving.
  return sequence > 1 ? `${base}-${sequence}` : base;
}

/** Shape the UI needs to name a lot; satisfied by a full Lot or a select. */
export type LotLike = Pick<Lot, "code" | "kind" | "closedAt">;

/**
 * One lot as a form dropdown sees it.
 *
 * `closedAt` is a string because this crosses the server/client boundary into a
 * "use client" form, and a Date would have to be serialised anyway.
 */
export type LotOption = {
  id: string;
  code: string;
  kind: "CONSIGNMENT" | "OVERHEAD";
  closedAt: string | null;
};

/** How a lot reads in a dropdown or a heading. */
export function lotLabel(lot: LotLike): string {
  if (lot.kind === "OVERHEAD") return OVERHEAD_LOT_LABEL;
  return lot.closedAt ? `${lot.code} (closed)` : lot.code;
}

export const isLotOpen = (lot: Pick<Lot, "closedAt">) => lot.closedAt === null;
