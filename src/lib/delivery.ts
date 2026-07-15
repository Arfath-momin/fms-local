import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { DeliveryChannel } from "@/generated/prisma/enums";

export const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  FACTORY: "Factory",
  MARKET: "Market",
  FISH_MILL: "Fish Mill",
  LOCAL_SALE: "Local Sale",
};

/** Days after which an unsettled delivery gets the warning state (design doc #2). */
export const PENDING_WARN_DAYS = 3;

const ZERO = new Prisma.Decimal(0);

export type SettledTotals = {
  accepted: Prisma.Decimal;
  returned: Prisma.Decimal;
  spoiled: Prisma.Decimal;
  total: Prisma.Decimal;
  amountReceived: Prisma.Decimal;
};

/** Sum of all settlements against a delivery note. */
export async function getSettledTotals(
  tx: Prisma.TransactionClient,
  deliveryNoteId: string
): Promise<SettledTotals> {
  const agg = await tx.settlement.aggregate({
    where: { deliveryNoteId },
    _sum: { qtyAccepted: true, qtyReturned: true, qtySpoiled: true, amountReceived: true },
  });
  const accepted = agg._sum.qtyAccepted ?? ZERO;
  const returned = agg._sum.qtyReturned ?? ZERO;
  const spoiled = agg._sum.qtySpoiled ?? ZERO;
  return {
    accepted,
    returned,
    spoiled,
    total: accepted.add(returned).add(spoiled),
    amountReceived: agg._sum.amountReceived ?? ZERO,
  };
}

/** Append an owner-reserve credit (spec §2 OwnerReserveAccount). */
export async function postOwnerReserveEntry(
  tx: Prisma.TransactionClient,
  args: {
    companyId: string;
    settlementId: string;
    amount: Prisma.Decimal;
    date: Date;
  }
) {
  const last = await tx.ownerReserveEntry.findFirst({
    where: { companyId: args.companyId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { runningBalance: true },
  });
  const prev = last?.runningBalance ?? ZERO;
  return tx.ownerReserveEntry.create({
    data: { ...args, runningBalance: prev.add(args.amount) },
  });
}
