import { Prisma } from "@/generated/prisma/client";
import type { LedgerSourceType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import {
  VoucherDocument,
  sheetsFor,
  type Column,
  type Row,
} from "@/pdf/voucher-doc";
import { PACK_LABELS } from "@/lib/pack";
import { expenseHighlight } from "@/lib/expense";
import { pdfFilename, pdfResponse } from "@/pdf/render";
import { letterheadFor } from "@/pdf/letterhead";

/**
 * A party's statement of account, as a downloadable PDF.
 *
 * The one document in the set that regularly leaves the building — what gets
 * handed to a boat owner or a buyer who disputes what they are owed. So it
 * prints the WHOLE window rather than one page of it: a statement missing rows
 * 51 onward is not a statement, and paging is the printer's business.
 *
 * The headline balance deliberately does not follow the window. It is what the
 * party owes NOW, which is the figure they will be asked to settle.
 */
const ZERO = new Prisma.Decimal(0);

const SOURCE_LABELS: Record<LedgerSourceType, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
  RENT: "Vehicle rent",
  RENT_BY_PARTY: "Rent paid to driver",
  // Retired — kept only so historic rows still render a name.
  COMMISSION: "Commission",
  RESERVE: "Reserve",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return new Response("No centre selected.", { status: 400 });
  const { id } = await params;

  const party = await prisma.party.findUnique({
    where: { id },
    select: { id: true, name: true, type: true },
  });
  if (!party) return new Response("Not found.", { status: 404 });

  const url = new URL(req.url);
  const listWindow = parseListWindow(
    Object.fromEntries(url.searchParams) as SearchParams
  );
  const scope = { companyId: company.id, centreId: centre.id, partyId: id };

  const [entries, prior] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { ...scope, ...dateWhere(listWindow) },
      orderBy: [{ date: "asc" }, { seq: "asc" }],
    }),
    // Where the account stood the day BEFORE this window opened — the last
    // entry strictly earlier than `from`, in the same (date, seq) order the
    // running balance is built in.
    prisma.ledgerEntry.findFirst({
      where: { ...scope, date: { lt: listWindow.fromDate } },
      orderBy: [{ date: "desc" }, { seq: "desc" }],
      select: { runningBalance: true },
    }),
  ]);

  // What each row is FOR. "Sale ₹75,000" is not a statement line: a buyer
  // disputing it is holding a bill with a number on it, and a row they cannot
  // match to that number is a row they will query.
  const sourceIds = [...new Set(entries.map((e) => e.sourceId))];
  const [sales, purchases, expenses, settlements, trips] = await Promise.all([
    // The LINES come back too, because a statement now itemises each voucher
    // under its own row. Still one query per voucher kind over the ids on this
    // statement, never one per row.
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
    prisma.settlement.findMany({ where: { id: { in: sourceIds } }, select: { id: true, reference: true } }),
    prisma.deliveryNote.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, billNo: true, vehicle: { select: { number: true } } },
    }),
  ]);
  const detail = new Map<string, string>();
  for (const x of sales) if (x.billNo) detail.set(x.id, `Bill ${x.billNo}`);
  for (const x of purchases) if (x.billNo) detail.set(x.id, `Bill ${x.billNo}`);
  for (const x of expenses) detail.set(x.id, x.category.name);
  for (const x of settlements) if (x.reference) detail.set(x.id, x.reference);
  for (const x of trips) detail.set(x.id, `${x.billNo} · ${x.vehicle.number}`);

  /**
   * What each voucher's lines say, ready to print under its entry.
   *
   * A statement used to name the bill and stop there, so "Purchase · Bill
   * S-1042 · ₹1,85,000" told a seller the total and nothing about the fish. A
   * merchant disputing a figure wants the lots.
   *
   * Each line is [what it was, what came, what it cost] and the amount goes in
   * the SAME money column as the entry above it, so the lines visibly add up to
   * the row they belong to.
   */
  const itemsFor = new Map<string, { text: string; amount: string }[]>();

  for (const p of purchases) {
    itemsFor.set(
      p.id,
      p.lines.map((l) => {
        const bits = [l.boat?.name, l.particular].filter(Boolean);
        const qty = [
          l.box > 0 ? `${l.box} box` : null,
          `${fmtKg(l.qtyKg)} @ ${fmtMoney(l.pricePerKg)}`,
        ]
          .filter(Boolean)
          .join(" · ");
        return { text: `${bits.join(" · ")} — ${qty}`, amount: fmtMoney(l.total) };
      })
    );
  }

  for (const sale of sales) {
    const isMarket = sale.type === "MARKET";
    itemsFor.set(
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
    // own figure — the blocks of ice, the boxes loaded.
    const h = expenseHighlight(
      x.category.code,
      x.details as Record<string, string> | null
    );
    if (h) itemsFor.set(x.id, [{ text: h, amount: "" }]);
  }

  /**
   * Where the account stood when this window opened.
   *
   * Read from the last entry BEFORE the window rather than worked back off the
   * window's first row. Both give the same answer when the window has rows —
   * and when it has none, working back has nothing to work from. It used to
   * fall back to the balance as at today, so a September statement for a party
   * with no September activity opened at October's figure.
   */
  const opening = prior?.runningBalance ?? ZERO;

  const columns: Column[] = [
    // Wide enough for the LONGEST month name, not the shortest. At 68 it fitted
    // "16 Aug 2026" and overflowed "05 Sept 2026", so a September statement had
    // every row's particulars shunted left of the heading above them.
    { label: "Date", width: 82 },
    { label: "Particulars", flex: 1 },
    // Wide enough for a lakh figure with its padding: ₹16,16,001.00 is
    // thirteen characters, and a month of a society's trading is full of them.
    // The particulars column is flexible and gives up the room, which it has —
    // it was taking half the sheet to print "Purchase · Bill 1105".
    { label: "Debit", width: 88, align: "right" },
    { label: "Credit", width: 88, align: "right" },
    { label: "Balance", width: 94, align: "right" },
  ];

  const rows: Row[] = [["", "Opening balance", "", "", fmtMoney(opening)]];
  for (const e of entries) {
    const d = detail.get(e.sourceId);
    rows.push([
      fmtDate(e.date),
      d ? `${SOURCE_LABELS[e.sourceType]} · ${d}` : SOURCE_LABELS[e.sourceType],
      e.type === "DEBIT" ? fmtMoney(e.amount) : "",
      e.type === "CREDIT" ? fmtMoney(e.amount) : "",
      fmtMoney(e.runningBalance),
    ]);
    // The lines beneath, in the money column their entry used, so they add up
    // to it on the page.
    //
    // Only for an entry that IS the voucher. A rent credit and the debit for
    // what a market handed the driver are both sourced from a sale — they carry
    // its id so they can be found and undone with it — but they are about the
    // journey, not the fish. Printing the sale's lots under a transporter's
    // rent said his ₹20,000 was made of eighteen boxes of prawns, which is not
    // a claim anybody would recognise.
    const carriesItems =
      e.sourceType === "SALE" ||
      e.sourceType === "PURCHASE" ||
      e.sourceType === "EXPENSE";
    for (const item of carriesItems ? (itemsFor.get(e.sourceId) ?? []) : []) {
      rows.push({
        muted: true,
        cells: [
          "",
          item.text,
          e.type === "DEBIT" ? item.amount : "",
          e.type === "CREDIT" ? item.amount : "",
          "",
        ],
      });
    }
  }

  const debits = entries
    .filter((e) => e.type === "DEBIT")
    .reduce((a, e) => a.add(e.amount), ZERO);
  const credits = entries
    .filter((e) => e.type === "CREDIT")
    .reduce((a, e) => a.add(e.amount), ZERO);

  /**
   * Where the account stood at the END of the window asked for.
   *
   * The last row's running balance — or the opening figure when the window
   * holds no rows at all, because an account nothing happened to closes where
   * it opened.
   *
   * This replaces the balance "as at today", which was the fault. A statement
   * for September footed with a figure that included October: thirty September
   * transactions, and then five made in October quietly moved the total the
   * seller was being asked to agree with. A statement has to be answerable from
   * itself — opening, what happened, closing — or the reader cannot check it.
   */
  const closing = entries.at(-1)?.runningBalance ?? opening;

  const letterhead = await letterheadFor(company.id);

  const doc = (
    <VoucherDocument
      d={{
        letterhead,
        centreName: centre.name,
        docKind: "Statement of Account",
        identity: [
          { label: "From", value: fmtDate(listWindow.fromDate) },
          { label: "To", value: fmtDate(listWindow.toDate) },
        ],
        partyTitle: "Statement for",
        partyName: party.name,
        partySub: null,
        // Opening is stated twice already — as the table's first row and in the
        // summary below it — so it does not belong up here as well.
        details: [],
        columns,
        rows,
        totalRow: ["", "Total", fmtMoney(debits), fmtMoney(credits), ""],
        working: [
          // No dates repeated in these labels: the head of the sheet already
          // states From and To in the place a reader looks for them, and
          // "Closing balance · 30 Sept 2026" beside a lakh figure left the two
          // touching.
          { label: "Opening balance", value: fmtMoney(opening) },
          { label: "Debits in this period", value: fmtMoney(debits) },
          { label: "Credits in this period", value: fmtMoney(credits) },
          {
            label: "Closing balance",
            value: fmtMoney(closing),
            rule: true,
            strong: true,
          },
        ],
        amountInWords: null,
        footNote:
          "Opening, the movements above and closing are all within the From " +
          "and To dates at the head of this statement — nothing outside them " +
          "is counted. A positive balance is what this party owes; a negative " +
          "one is what is owed to them.",
        notes: null,
        signLeft: null,
        signRight: `FOR ${company.name.toUpperCase()}`,
        // Detail lines are shorter than entry rows, so counting them as full
        // rows over-estimates how far the table reaches. Over-estimating only
        // leaves a stray heading on a sheet; under-estimating drops the
        // headings from a sheet that has rows.
        lastItemPage: sheetsFor(rows.length),
      }}
    />
  );

  return pdfResponse(
    doc,
    pdfFilename(company.name, "statement", party.name, listWindow.to)
  );
}
