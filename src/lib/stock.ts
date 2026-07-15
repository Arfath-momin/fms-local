import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  StockDirection,
  StockSourceType,
  StockState,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

type PostMovementArgs = {
  companyId: string;
  fishType: string;
  qtyKg: Prisma.Decimal | string | number;
  direction: StockDirection;
  state: StockState;
  sourceType: StockSourceType;
  sourceId: string;
  date: Date;
};

/**
 * Append one stock movement row. The table is append-only: state transitions
 * are recorded as an OUT-from-old-state / IN-to-new-state pair in the same
 * transaction, which is what keeps the reconciliation invariant a pure sum
 * (spec §2 StockMovement).
 */
export async function postStockMovement(
  tx: Prisma.TransactionClient,
  args: PostMovementArgs
) {
  return tx.stockMovement.create({
    data: { ...args, qtyKg: new Prisma.Decimal(args.qtyKg) },
  });
}

/** Net quantity currently in a given state for one fish type. */
export async function getNetQty(
  tx: Prisma.TransactionClient,
  companyId: string,
  fishType: string,
  state: StockState
): Promise<Prisma.Decimal> {
  const groups = await tx.stockMovement.groupBy({
    by: ["direction"],
    where: { companyId, fishType, state },
    _sum: { qtyKg: true },
  });
  let net = new Prisma.Decimal(0);
  for (const g of groups) {
    const sum = g._sum.qtyKg ?? new Prisma.Decimal(0);
    net = g.direction === "IN" ? net.add(sum) : net.sub(sum);
  }
  return net;
}

export type StockRow = {
  fishType: string;
  available: Prisma.Decimal;
  inTransit: Prisma.Decimal;
  sold: Prisma.Decimal;
  loss: Prisma.Decimal;
  /** available + inTransit + sold + loss — must equal purchased. */
  accounted: Prisma.Decimal;
  /** Independently computed: net IN with source PURCHASE. */
  purchased: Prisma.Decimal;
  reconciles: boolean;
};

const ZERO = new Prisma.Decimal(0);

/**
 * Full reconciliation summary per fish type. `accounted` is the sum across
 * the four states; `purchased` is computed independently from purchase-sourced
 * rows, so a mismatch means the ledger has drifted (spec §2 invariant).
 */
export async function getStockSummary(companyId: string): Promise<StockRow[]> {
  const [byState, purchases] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ["fishType", "state", "direction"],
      where: { companyId },
      _sum: { qtyKg: true },
    }),
    prisma.stockMovement.groupBy({
      by: ["fishType", "direction"],
      where: { companyId, sourceType: "PURCHASE" },
      _sum: { qtyKg: true },
    }),
  ]);

  const rows = new Map<string, StockRow>();
  const row = (fishType: string): StockRow => {
    let r = rows.get(fishType);
    if (!r) {
      r = {
        fishType,
        available: ZERO,
        inTransit: ZERO,
        sold: ZERO,
        loss: ZERO,
        accounted: ZERO,
        purchased: ZERO,
        reconciles: true,
      };
      rows.set(fishType, r);
    }
    return r;
  };

  const STATE_KEY = {
    AVAILABLE: "available",
    IN_TRANSIT: "inTransit",
    SOLD: "sold",
    LOSS: "loss",
  } as const;

  for (const g of byState) {
    const r = row(g.fishType);
    const key = STATE_KEY[g.state];
    const sum = g._sum.qtyKg ?? ZERO;
    r[key] = g.direction === "IN" ? r[key].add(sum) : r[key].sub(sum);
  }
  for (const g of purchases) {
    const r = row(g.fishType);
    const sum = g._sum.qtyKg ?? ZERO;
    r.purchased = g.direction === "IN" ? r.purchased.add(sum) : r.purchased.sub(sum);
  }
  for (const r of rows.values()) {
    r.accounted = r.available.add(r.inTransit).add(r.sold).add(r.loss);
    r.reconciles = r.accounted.equals(r.purchased);
  }

  return [...rows.values()].sort((a, b) =>
    a.fishType.localeCompare(b.fishType)
  );
}

/** Distinct fish types already used in a company (for form suggestions). */
export async function getKnownFishTypes(companyId: string): Promise<string[]> {
  const rows = await prisma.stockMovement.findMany({
    where: { companyId },
    distinct: ["fishType"],
    select: { fishType: true },
    orderBy: { fishType: "asc" },
  });
  return rows.map((r) => r.fishType);
}
