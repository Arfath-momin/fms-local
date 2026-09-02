"use client";

/**
 * Add another row for the same fish.
 *
 * A load comes in as ten lots of prawns at different weights, and typing
 * "Prawns" ten times is ten chances to type it nine different ways — which is
 * how one particular becomes several on a report.
 *
 * ONLY the particular is carried over. Every figure comes across empty and has
 * to be typed, and that is the whole safety of it: a duplicate that arrived
 * pre-filled and was saved unedited would book the same fish twice, on a
 * voucher where nothing would look wrong. One field of typing buys the
 * guarantee that the merchant looked at every number they are paying for.
 *
 * The new row goes directly BELOW the one it came from, not at the end. A list
 * of twenty lots reads in the order it was unloaded, and a copy that jumps to
 * the bottom loses that.
 */
export function DuplicateRow({
  onDuplicate,
  row,
}: {
  onDuplicate: () => void;
  /** 1-based, for the label a screen reader reads out. */
  row: number;
}) {
  return (
    <button
      type="button"
      onClick={onDuplicate}
      className="text-accent text-[15px] leading-none px-1"
      title="Another row for the same particular"
      aria-label={`Duplicate row ${row}`}
    >
      ⧉
    </button>
  );
}

/**
 * Insert a copy of `lines[i]` after it, keeping only the particular.
 *
 * Shared so the three entry screens cannot drift into copying different things
 * — the sale form quietly carrying the rate while the purchase form does not is
 * exactly the kind of difference nobody notices until a figure is wrong.
 */
export function duplicateAt<T extends { particular?: string; particulars?: string }>(
  lines: T[],
  i: number,
  blank: T
): T[] {
  const source = lines[i];
  const copy: T = { ...blank };
  // The two forms spell it differently; whichever this one uses is the one
  // carried over.
  if ("particular" in source) {
    (copy as { particular?: string }).particular = source.particular;
  }
  if ("particulars" in source) {
    (copy as { particulars?: string }).particulars = source.particulars;
  }
  return [...lines.slice(0, i + 1), copy, ...lines.slice(i + 1)];
}
