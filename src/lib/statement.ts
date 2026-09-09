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
  /** sourceId → the lines beneath it. */
  items: Map<string, StatementItem[]>;
};

/**
 * Whether a row itemises.
 *
 * Only an entry that IS the voucher. A rent credit and the debit for what a
 * market handed the driver are both sourced from a SALE — they carry its id so
 * they can be found and undone with it — but they are about the journey, not
 * the fish. Printed naively, a transporter's statement said his ₹20,000 rent
 * was made of eighteen boxes of prawns.
 */
export function carriesItems(t: LedgerSourceType): boolean {
  return t === "SALE" || t === "PURCHASE" || t === "EXPENSE";
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
  if (sourceIds.length === 0) return { detail, items };

  const [sales, purchases, expenses, settlements, trips] = await Promise.all([
    prisma.sale.findMany({
      where: { id: { in: sourceIds } },
      select: {
        id: true,
        billNo: true,
        type: true,
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
        category: { select: { name: true, code: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, reference: true },
    }),
    prisma.deliveryNote.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, billNo: true, vehicle: { select: { number: true } } },
    }),
  ]);

  for (const x of sales) if (x.billNo) detail.set(x.id, `Bill ${x.billNo}`);
  for (const x of purchases) if (x.billNo) detail.set(x.id, `Bill ${x.billNo}`);
  for (const x of expenses) detail.set(x.id, x.category.name);
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

  return { detail, items };
}
