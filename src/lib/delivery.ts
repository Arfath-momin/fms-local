import "server-only";
import { Prisma } from "@/generated/prisma/client";

export type DeliveryLine = {
  kg: Prisma.Decimal | number | string;
  box: number;
  bigBox: number;
  loose: number;
  pcs: number;
};

export type DeliveryTotals = {
  /** Sum of the per-box figures as entered — the column total, not a weight. */
  kg: Prisma.Decimal;
  /** What actually went on the vehicle: Σ (kg per box × boxes). */
  totalKg: Prisma.Decimal;
  box: number;
  bigBox: number;
  loose: number;
  pcs: number;
};

/**
 * The weight one line represents.
 *
 * `kg` is the weight of a single box, not of the row — 25 kg packed into 10
 * boxes is 250 kg dispatched. A row with no boxes (loose or pieces only) has
 * nowhere to multiply, so its kg counts once; multiplying by zero would erase
 * the weight of everything shipped loose.
 */
export function lineTotalKg(line: Pick<DeliveryLine, "kg" | "box">): Prisma.Decimal {
  const kg = new Prisma.Decimal(line.kg);
  return line.box > 0 ? kg.mul(line.box) : kg;
}

/**
 * Column totals for a delivery note's line items — display only. A delivery
 * note is a pure record; these sums carry no accounting meaning.
 */
export function sumDeliveryLines(lines: DeliveryLine[]): DeliveryTotals {
  return lines.reduce<DeliveryTotals>(
    (acc, l) => ({
      kg: acc.kg.add(new Prisma.Decimal(l.kg)),
      totalKg: acc.totalKg.add(lineTotalKg(l)),
      box: acc.box + l.box,
      bigBox: acc.bigBox + l.bigBox,
      loose: acc.loose + l.loose,
      pcs: acc.pcs + l.pcs,
    }),
    {
      kg: new Prisma.Decimal(0),
      totalKg: new Prisma.Decimal(0),
      box: 0,
      bigBox: 0,
      loose: 0,
      pcs: 0,
    }
  );
}
