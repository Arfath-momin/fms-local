import "server-only";
import { Prisma } from "@/generated/prisma/client";

export type DeliveryLine = {
  /**
   * The line's TOTAL weight, not the weight of one box.
   *
   * This used to hold the per-box figure, with the row's real weight derived as
   * kg × box. It was the wrong way round: at dispatch the merchant weighs the
   * consignment, not a sample box, so the total is what is actually known and
   * the per-box average is what has to be worked out. Flipping it means the
   * figure typed is the figure known.
   */
  kg: Prisma.Decimal | number | string;
  box: number;
  bigBox: number;
  loose: number;
  pcs: number;
};

export type DeliveryTotals = {
  /** Total weight dispatched — the sum of the line totals. */
  totalKg: Prisma.Decimal;
  box: number;
  bigBox: number;
  loose: number;
  pcs: number;
  /** totalKg / box, for the whole note. Zero when nothing is boxed. */
  avgKgPerBox: Prisma.Decimal;
};

const ZERO = new Prisma.Decimal(0);

/** The average weight of one box on this line. Zero when the line has none. */
export function lineKgPerBox(
  line: Pick<DeliveryLine, "kg" | "box">
): Prisma.Decimal {
  if (line.box <= 0) return ZERO;
  return new Prisma.Decimal(line.kg).div(line.box).toDecimalPlaces(3);
}

/**
 * The weight one line represents.
 *
 * Now simply what was entered — see the note on DeliveryLine.kg. Kept as a
 * function rather than inlined because every caller reading a line's weight
 * should go through one place if the rule ever moves again.
 */
export function lineTotalKg(
  line: Pick<DeliveryLine, "kg" | "box">
): Prisma.Decimal {
  return new Prisma.Decimal(line.kg);
}

/**
 * Column totals for a delivery note's line items — display only. A delivery
 * note records what went out; these sums carry no accounting meaning.
 */
export function sumDeliveryLines(lines: DeliveryLine[]): DeliveryTotals {
  const base = lines.reduce(
    (acc, l) => ({
      totalKg: acc.totalKg.add(new Prisma.Decimal(l.kg)),
      box: acc.box + l.box,
      bigBox: acc.bigBox + l.bigBox,
      loose: acc.loose + l.loose,
      pcs: acc.pcs + l.pcs,
    }),
    { totalKg: ZERO, box: 0, bigBox: 0, loose: 0, pcs: 0 }
  );

  return {
    ...base,
    avgKgPerBox:
      base.box > 0 ? base.totalKg.div(base.box).toDecimalPlaces(3) : ZERO,
  };
}
