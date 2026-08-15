import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Lot } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { lotCodeFor, OVERHEAD_LOT_CODE, type LotOption } from "@/lib/lot";

type Scope = { companyId: string; centreId: string };

/**
 * The consignment lot for a buying day, opened on first use.
 *
 * Called from the purchase actions inside their existing transaction, so the
 * merchant never opens a lot by hand — entering the day's first bill is what
 * creates it, and a purchase can therefore never end up belonging to nothing.
 * Same find-or-create shape as findOrCreateParty, for the same reason: the
 * thing being named should come into existence the moment it is needed.
 *
 * The P2002 retry matters at the quay. Two purchases saved in the same second
 * both find no lot and both try to create one; the unique on
 * (company, centre, code) means one loses, and the loser must pick up the
 * winner's lot rather than failing a save the merchant already committed to.
 */
export async function findOrCreateLotForDate(
  tx: Prisma.TransactionClient,
  scope: Scope,
  date: Date
): Promise<string> {
  const code = lotCodeFor(date);

  const existing = await tx.lot.findUnique({
    where: { companyId_centreId_code: { ...scope, code } },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await tx.lot.create({
      data: { ...scope, code, openedOn: date, kind: "CONSIGNMENT" },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await tx.lot.findUniqueOrThrow({
        where: { companyId_centreId_code: { ...scope, code } },
        select: { id: true },
      });
      return raced.id;
    }
    throw e;
  }
}

/**
 * The centre's standing overhead lot, created on first use.
 *
 * Monthly rent and shop costs belong to no single catch. Every sale and expense
 * must name a lot, so without somewhere honest to put them they would land on
 * whichever consignment happened to be open and make it look unprofitable for
 * reasons that had nothing to do with that fish.
 */
export async function findOrCreateOverheadLot(
  tx: Prisma.TransactionClient,
  scope: Scope
): Promise<string> {
  const existing = await tx.lot.findUnique({
    where: { companyId_centreId_code: { ...scope, code: OVERHEAD_LOT_CODE } },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await tx.lot.create({
      data: {
        ...scope,
        code: OVERHEAD_LOT_CODE,
        // Never displayed — the overhead lot is not a day. It is set to the
        // epoch so it sorts below every real consignment in any date ordering.
        openedOn: new Date("1970-01-01T00:00:00.000Z"),
        kind: "OVERHEAD",
      },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await tx.lot.findUniqueOrThrow({
        where: { companyId_centreId_code: { ...scope, code: OVERHEAD_LOT_CODE } },
        select: { id: true },
      });
      return raced.id;
    }
    throw e;
  }
}

export type LotChoice = Pick<
  Lot,
  "id" | "code" | "kind" | "openedOn" | "closedAt"
>;

/**
 * The lots a sale or expense form may offer: this centre's open consignments,
 * newest first, with General last.
 *
 * `include` re-admits one closed lot — the one already on the voucher being
 * edited. Without it, correcting last week's sale would silently move it onto a
 * different lot and change the profit of two consignments at once.
 */
export async function selectableLots(
  scope: Scope,
  include?: string | null
): Promise<LotChoice[]> {
  const lots = await prisma.lot.findMany({
    where: {
      ...scope,
      OR: [{ closedAt: null }, ...(include ? [{ id: include }] : [])],
    },
    select: { id: true, code: true, kind: true, openedOn: true, closedAt: true },
    orderBy: [{ kind: "asc" }, { openedOn: "desc" }],
  });
  // kind ASC puts CONSIGNMENT before OVERHEAD (enum declaration order), so the
  // newest buying day is the first option and General falls to the bottom.
  return lots;
}

/**
 * Everything a sale or expense form needs to render its lot dropdown.
 *
 * The default is the newest open consignment, because selling yesterday's fish
 * today is the ordinary case and the ordinary case should need no thought. It
 * is undefined when the centre has no open consignment — a new centre, or one
 * sold out — and the form then makes the merchant choose rather than guessing.
 *
 * Pass `current` when editing, so the lot the voucher is already on stays
 * selectable even if it has since been closed.
 */
export async function lotFieldData(
  scope: Scope,
  current?: string | null
): Promise<{ lots: LotOption[]; defaultLotId?: string }> {
  // Ensured here rather than only at centre creation, so a centre that predates
  // lots — or one whose backfill was never run — still offers somewhere to put
  // the rent. It is a find-or-create keyed on a unique constraint, so it writes
  // at most once per centre in the life of the system and is a plain read every
  // time after that.
  await findOrCreateOverheadLot(prisma, scope);

  const lots = await selectableLots(scope, current);
  return {
    lots: lots.map((l) => ({
      id: l.id,
      code: l.code,
      kind: l.kind,
      closedAt: l.closedAt ? l.closedAt.toISOString() : null,
    })),
    defaultLotId: lots.find((l) => l.kind === "CONSIGNMENT" && !l.closedAt)?.id,
  };
}

/**
 * Confirm a submitted lot id is one this voucher may actually use.
 *
 * The dropdown already limits the choice, but a form field is only a
 * suggestion: this is what stops a hand-made request filing a sale against
 * another centre's lot, where it would silently corrupt that centre's profit.
 */
export async function assertUsableLot(
  tx: Prisma.TransactionClient,
  scope: Scope,
  lotId: string,
  allowClosed?: string | null
): Promise<{ error: string } | null> {
  const lot = await tx.lot.findFirst({
    where: { id: lotId, ...scope },
    select: { id: true, code: true, closedAt: true },
  });
  if (!lot)
    return { error: "That lot does not belong to this company and centre." };
  if (lot.closedAt && lot.id !== allowClosed)
    return {
      error: `Lot ${lot.code} is closed. Reopen it from Lots, or pick an open one.`,
    };
  return null;
}
