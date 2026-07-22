import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { DeliveryChannel } from "@/generated/prisma/enums";

export const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  MARKET: "Market",
  FACTORY: "Factory",
  FISH_MILL: "Fish Mill",
  LOCAL: "Local",
};

/** Days after which an unsettled delivery gets the warning state. */
export const PENDING_WARN_DAYS = 3;

const ZERO = new Prisma.Decimal(0);

/** Total received across all settlement bills for a delivery note. */
export async function getSettledAmount(
  tx: Prisma.TransactionClient,
  deliveryNoteId: string
): Promise<Prisma.Decimal> {
  const agg = await tx.settlement.aggregate({
    where: { deliveryNoteId },
    _sum: { amountReceived: true },
  });
  return agg._sum.amountReceived ?? ZERO;
}
