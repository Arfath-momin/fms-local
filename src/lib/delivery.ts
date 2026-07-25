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
  kg: Prisma.Decimal;
  box: number;
  bigBox: number;
  loose: number;
  pcs: number;
};

/**
 * Column totals for a delivery note's line items — display only. A delivery
 * note is a pure record; these sums carry no accounting meaning.
 */
export function sumDeliveryLines(lines: DeliveryLine[]): DeliveryTotals {
  return lines.reduce<DeliveryTotals>(
    (acc, l) => ({
      kg: acc.kg.add(new Prisma.Decimal(l.kg)),
      box: acc.box + l.box,
      bigBox: acc.bigBox + l.bigBox,
      loose: acc.loose + l.loose,
      pcs: acc.pcs + l.pcs,
    }),
    { kg: new Prisma.Decimal(0), box: 0, bigBox: 0, loose: 0, pcs: 0 }
  );
}
