import "server-only";
import { prisma } from "@/lib/db";

/**
 * The empty-crate account, per market party.
 *
 * Crates are the one thing this system tracks in a unit other than money. They
 * leave full, the market keeps them while it sells, and the empties come back
 * on some later trip — so a market is always holding some number of them, and
 * that number is a debt in wood.
 *
 * Every balance here is DERIVED from the party's own rows in order, exactly as
 * a money ledger derives its running balance. Nothing is stored, so a corrected
 * row cannot leave a stale total behind it.
 */

export type CrateRow = {
  id: string;
  date: Date;
  partyId: string;
  partyName: string;
  place: string | null;
  /** The trip, when the row was entered against one. */
  tripId: string | null;
  tripBillNo: string | null;
  vehicleNumber: string | null;
  /** Whoever unloaded this trip, off the trip's own Line Man expense. */
  lineManName: string | null;
  /** The running balance BEFORE this row — what they already held. */
  openingBalance: number;
  boxesOut: number;
  boxesReturned: number;
  /** opening + out − returned. */
  balance: number;
  notes: string | null;
};

export type CrateBalance = {
  partyId: string;
  partyName: string;
  out: number;
  returned: number;
  /** out − returned. What this market is still holding. */
  holding: number;
  lastMovement: Date | null;
};

/**
 * Who unloaded each of these trips.
 *
 * Read from the trip's own Line Man expense rather than stored on the crate
 * row. A line man is recorded once, on the voucher that pays him, and naming
 * him again here would be a second copy free to disagree with the first — and
 * the one that gets corrected is never the copy.
 *
 * One query for every trip on the page, not one per row.
 */
async function lineMenByTrip(
  tripIds: string[]
): Promise<Map<string, string>> {
  if (tripIds.length === 0) return new Map();
  const rows = await prisma.expense.findMany({
    where: {
      deliveryNoteId: { in: tripIds },
      category: { code: "LINE_MAN" },
    },
    orderBy: { createdAt: "asc" },
    select: { deliveryNoteId: true, party: { select: { name: true } } },
  });
  const byTrip = new Map<string, string>();
  for (const r of rows) {
    if (!r.deliveryNoteId || !r.party) continue;
    const existing = byTrip.get(r.deliveryNoteId);
    // More than one man on a load is normal on a big trip. Naming them all
    // beats picking one and implying he did it alone.
    byTrip.set(
      r.deliveryNoteId,
      existing ? `${existing}, ${r.party.name}` : r.party.name
    );
  }
  return byTrip;
}

/**
 * One market's crate statement, oldest first, with a running balance.
 *
 * The whole account is read, not just the window on screen: an opening balance
 * that ignored earlier rows would be wrong by exactly the rows it skipped, and
 * a crate account is short enough that reading it whole costs nothing.
 */
export async function crateStatement(
  scope: { companyId: string; centreId: string },
  partyId: string
): Promise<CrateRow[]> {
  const rows = await prisma.crateEntry.findMany({
    where: { ...scope, partyId },
    orderBy: [{ date: "asc" }, { seq: "asc" }],
    select: {
      id: true,
      date: true,
      partyId: true,
      place: true,
      boxesOut: true,
      boxesReturned: true,
      notes: true,
      party: { select: { name: true } },
      deliveryNote: {
        select: {
          id: true,
          billNo: true,
          vehicle: { select: { number: true } },
        },
      },
    },
  });

  const lineMen = await lineMenByTrip(
    [...new Set(rows.map((r) => r.deliveryNote?.id).filter((x) => x != null))]
  );

  let running = 0;
  return rows.map((r) => {
    const openingBalance = running;
    running = openingBalance + r.boxesOut - r.boxesReturned;
    return {
      id: r.id,
      date: r.date,
      partyId: r.partyId,
      partyName: r.party.name,
      place: r.place,
      tripId: r.deliveryNote?.id ?? null,
      tripBillNo: r.deliveryNote?.billNo ?? null,
      vehicleNumber: r.deliveryNote?.vehicle.number ?? null,
      lineManName: r.deliveryNote
        ? (lineMen.get(r.deliveryNote.id) ?? null)
        : null,
      openingBalance,
      boxesOut: r.boxesOut,
      boxesReturned: r.boxesReturned,
      balance: running,
      notes: r.notes,
    };
  });
}

/**
 * What every market is holding, most first.
 *
 * The list the merchant actually acts on: who to chase for crates. Grouped in
 * the database rather than walked row by row, because this is the landing
 * screen and it should not get slower as the years accumulate.
 */
export async function crateBalances(scope: {
  companyId: string;
  centreId: string;
}): Promise<CrateBalance[]> {
  const groups = await prisma.crateEntry.groupBy({
    by: ["partyId"],
    where: scope,
    _sum: { boxesOut: true, boxesReturned: true },
    _max: { date: true },
  });
  if (groups.length === 0) return [];

  const parties = await prisma.party.findMany({
    where: { id: { in: groups.map((g) => g.partyId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(parties.map((p) => [p.id, p.name]));

  return groups
    .map((g) => {
      const out = g._sum.boxesOut ?? 0;
      const returned = g._sum.boxesReturned ?? 0;
      return {
        partyId: g.partyId,
        partyName: nameById.get(g.partyId) ?? "Unknown party",
        out,
        returned,
        holding: out - returned,
        lastMovement: g._max.date ?? null,
      };
    })
    .sort(
      (a, b) => b.holding - a.holding || a.partyName.localeCompare(b.partyName)
    );
}

/**
 * The boxes a market's bills say went to it on one trip.
 *
 * A prefill for the entry form and nothing more. The count that is stored is
 * the one the merchant types, because a crate that went out broken, or went out
 * and was handed straight back, never reaches a bill.
 */
export async function boxesBilledTo(
  scope: { companyId: string; centreId: string },
  tripId: string,
  partyId: string
): Promise<number> {
  const sales = await prisma.sale.findMany({
    where: { ...scope, deliveryNoteId: tripId, partyId },
    select: { lines: { select: { box: true, pack: true } } },
  });
  return sales
    .flatMap((s) => s.lines)
    // LOOSE is fish too big to box — it travels on the truck bed and carries no
    // crate, so counting it here would send out crates that never existed.
    .filter((l) => l.pack !== "LOOSE")
    .reduce((a, l) => a + (l.box ?? 0), 0);
}
