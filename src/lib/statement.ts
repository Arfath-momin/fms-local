import "server-only";
import type { LedgerSourceType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { fmtKg, fmtMoney } from "@/lib/format";
import { expenseHighlight } from "@/lib/expense";
import { PACK_LABELS } from "@/lib/pack";

/**
 * What each row of a party's statement is FOR, and what it was made of.
 *
 * Shared by the statement on screen and the statement as a PDF. They said
 * different things for a while — the printed one named the bill and listed its
 * lots while the screen said only "Expense" — and a merchant checking the paper
 * against the screen found two documents about the same month. One definition,
 * one answer.
 */

/** A voucher's line, ready to print under the entry it belongs to. */
export type StatementItem = { text: string; amount: string };

export type StatementSources = {
  /** sourceId → what to append to the row's kind: "Bill S-1042", "Ice". */
  detail: Map<string, string>;
  /** sourceId → the voucher's own lines. */
  items: Map<string, StatementItem[]>;
  /**
   * sourceId → what the TRUCK carried.
   *
   * Keyed by the trip's id and, for a rent raised on a bill, by that bill's id
   * as well — so a rent row finds the load however it was recorded.
   */
  loads: Map<string, StatementItem[]>;
};

/**
 * The lines to print under one row.
 *
 * Two different questions, and which one a row is asking depends on what the
 * row IS.
 *
 * An entry that is the voucher — a sale, a purchase, an expense — lists what
 * the voucher was made of: the lots, the boxes, the blocks of ice.
 *
 * An entry about the JOURNEY — the rent, the advance handed over at loading,
 * the debit for what a market paid the driver — lists what the truck carried.
 * Those are all sourced from a sale or a trip and so could be made to print the
 * sale's lots, which would say a transporter's ₹20,000 rent was made of
 * eighteen boxes of prawns. What he is owed for is the load, and the load is
 * what the delivery note recorded.
 *
 * Anything else — a cash payment, a receipt — is money and shows nothing.
 */
export function statementLines(
  sources: StatementSources,
  sourceType: LedgerSourceType,
  sourceId: string
): StatementItem[] {
  if (sourceType === "SALE" || sourceType === "PURCHASE" || sourceType === "EXPENSE")
    return sources.items.get(sourceId) ?? [];
  if (
    sourceType === "RENT" ||
    sourceType === "RENT_BY_PARTY" ||
    sourceType === "PAYMENT"
  )
    return sources.loads.get(sourceId) ?? [];
  return [];
}

/**
 * Resolve every source on a statement in one pass.
 *
 * One query per voucher kind over the ids on this statement, never one per row
 * — a statement prints its whole window, and a per-row lookup would get slower
 * the longer a party has been dealt with.
 */
export async function statementSources(
  sourceIds: string[]
): Promise<StatementSources> {
  const detail = new Map<string, string>();
  const items = new Map<string, StatementItem[]>();
  const loads = new Map<string, StatementItem[]>();
  if (sourceIds.length === 0) return { detail, items, loads };

  const [sales, purchases, expenses, settlements, trips] = await Promise.all([
    prisma.sale.findMany({
      where: { id: { in: sourceIds } },
      select: {
        id: true,
        billNo: true,
        type: true,
        // The trip this bill came off, so a rent raised on it can name the load
        // the transporter actually hauled.
        deliveryNoteId: true,
        lines: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: {
            pack: true,
            particular: true,
            box: true,
            qtyKg: true,
            ratePerKg: true,
            total: true,
          },
        },
      },
    }),
    prisma.purchase.findMany({
      where: { id: { in: sourceIds } },
      select: {
        id: true,
        billNo: true,
        lines: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: {
            particular: true,
            box: true,
            qtyKg: true,
            pricePerKg: true,
            total: true,
            boat: { select: { name: true } },
          },
        },
      },
    }),
    prisma.expense.findMany({
      where: { id: { in: sourceIds } },
      select: {
        id: true,
        details: true,
        // The trip this was spent on — invariant 8. Rent posted as an ordinary
        // expense read simply "Vehicle Rent" on a transporter's statement, with
        // no way to tell one journey's from another's.
        deliveryNoteId: true,
        category: { select: { name: true, code: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, reference: true },
    }),
    prisma.deliveryNote.findMany({
      // Trips reached directly by an entry, AND the trips behind this
      // statement's bills and expenses — rent is recorded all three ways.
      where: {
        OR: [
          { id: { in: sourceIds } },
          { sales: { some: { id: { in: sourceIds } } } },
          { expenses: { some: { id: { in: sourceIds } } } },
        ],
      },
      select: {
        id: true,
        billNo: true,
        vehicle: { select: { number: true } },
        lines: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { pack: true, particulars: true, box: true, kg: true },
        },
      },
    }),
  ]);

  for (const x of sales) if (x.billNo) detail.set(x.id, `Bill ${x.billNo}`);
  for (const x of purchases) if (x.billNo) detail.set(x.id, `Bill ${x.billNo}`);
  const tripById = new Map(trips.map((t) => [t.id, t]));
  for (const x of expenses) {
    // Named by its trip where it has one, so a column of "Vehicle Rent" on a
    // haulier's statement becomes one journey per line.
    const t = x.deliveryNoteId ? tripById.get(x.deliveryNoteId) : null;
    detail.set(
      x.id,
      t ? `${x.category.name} · ${t.billNo} · ${t.vehicle.number}` : x.category.name
    );
  }
  for (const x of settlements) if (x.reference) detail.set(x.id, x.reference);
  for (const x of trips) detail.set(x.id, `${x.billNo} · ${x.vehicle.number}`);

  for (const p of purchases) {
    items.set(
      p.id,
      p.lines.map((l) => {
        const what = [l.boat?.name, l.particular].filter(Boolean).join(" · ");
        const qty = [
          l.box > 0 ? `${l.box} box` : null,
          `${fmtKg(l.qtyKg)} @ ${fmtMoney(l.pricePerKg)}`,
        ]
          .filter(Boolean)
          .join(" · ");
        return { text: `${what} — ${qty}`, amount: fmtMoney(l.total) };
      })
    );
  }

  for (const sale of sales) {
    const isMarket = sale.type === "MARKET";
    items.set(
      sale.id,
      sale.lines.map((l) => {
        const qty = [
          l.pack !== "BOX" ? PACK_LABELS[l.pack] : null,
          l.pack !== "LOOSE" && (l.box ?? 0) > 0 ? `${l.box} box` : null,
          Number(l.qtyKg) > 0 ? fmtKg(l.qtyKg) : null,
          // A market bill has no per-row price: its money is the net it paid.
          !isMarket && Number(l.ratePerKg) > 0
            ? `@ ${fmtMoney(l.ratePerKg)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          text: qty ? `${l.particular} — ${qty}` : l.particular,
          amount: !isMarket && Number(l.total) > 0 ? fmtMoney(l.total) : "",
        };
      })
    );
  }

  for (const x of expenses) {
    // An expense has no lines of its own; what explains its total is the head's
    // own figure — the blocks of ice, the boxes loaded and what each cost.
    const h = expenseHighlight(
      x.category.code,
      x.details as Record<string, string> | null
    );
    if (h) items.set(x.id, [{ text: h, amount: "" }]);
  }

  const loadByTrip = new Map(trips.map((t) => [t.id, loadOf(t)]));

  // What each truck carried, for the rows that are about the journey.
  function loadOf(t: (typeof trips)[number]): StatementItem[] {
    return t.lines.map((l) => {
      const qty = [
        l.pack !== "BOX" ? PACK_LABELS[l.pack] : null,
        l.pack !== "LOOSE" && l.box > 0 ? `${l.box} box` : null,
        Number(l.kg) > 0 ? fmtKg(l.kg) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      // No amount: a transporter is owed for the journey, not for the fish.
      return { text: qty ? `${l.particulars} — ${qty}` : l.particulars, amount: "" };
    });
  }

  for (const [id, load] of loadByTrip) loads.set(id, load);
  // A rent expense has no figure of its own to explain it, so it lists what the
  // truck carried — the same claim the RENT row above makes, and the reason the
  // haulier is owed anything. An expense that DOES explain itself keeps its own
  // line: ice says how many blocks, not what the fish was.
  for (const x of expenses) {
    if (!x.deliveryNoteId) continue;
    // Rent is the one head whose own figures do NOT explain it. A statement
    // already names the trip and the truck in the row above, so repeating them
    // underneath says nothing; what the haulier is owed for is the load. Every
    // other head explains itself — ice says how many blocks — and keeps its own
    // line, taking the load only when it has nothing of its own.
    const isRent = x.category.code === "RENT";
    if (items.has(x.id) && !isRent) continue;
    const load = loadByTrip.get(x.deliveryNoteId);
    if (load?.length) items.set(x.id, load);
  }

  // …and under the bill's id too, for a rent that was raised on the bill.
  for (const sale of sales) {
    const load = sale.deliveryNoteId && loadByTrip.get(sale.deliveryNoteId);
    if (load) loads.set(sale.id, load);
  }

  return { detail, items, loads };
}
