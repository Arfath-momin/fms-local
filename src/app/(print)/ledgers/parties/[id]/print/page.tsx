import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { LedgerSourceType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { PARTY_TYPE_LABELS } from "@/lib/party";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import { PrintHeader } from "../../../../letterhead";
import { PrintToolbar } from "../../../../print-toolbar";
import "../../../../voucher-print.css";

const ZERO = new Prisma.Decimal(0);

const SOURCE_LABELS: Record<LedgerSourceType, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
  RENT: "Vehicle rent",
  RENT_BY_PARTY: "Rent paid to driver",
  // Retired — kept only so historic rows still render a name (spec §3.6).
  COMMISSION: "Commission",
  RESERVE: "Reserve",
};

/**
 * A party's statement of account, as a document.
 *
 * This is the one printable in the set that regularly leaves the building — it
 * is what gets handed to a boat owner or a buyer who disputes what they are
 * owed. So it prints the whole window rather than one page of it: the screen
 * pages because scrolling a thousand rows is useless, but a statement missing
 * rows 51 onward is not a statement, and paging is the printer's job.
 *
 * The date window comes from the same query string the screen uses, so "Print"
 * always covers what was on screen. The headline balance deliberately does NOT
 * follow that window — it is what the party owes *now*, which is the figure
 * they will be asked to settle, not the balance as at the end of whichever
 * month happens to be displayed.
 */
export default async function PartyStatementPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const { id } = await params;
  const [party, letterhead] = await Promise.all([
    prisma.party.findUnique({ where: { id } }),
    // getActiveScope() returns the slim CompanyInfo the app chrome needs; the
    // letterhead wants the full postal identity.
    prisma.company.findUnique({
      where: { id: company.id },
      select: {
        id: true, name: true, legalName: true, address: true,
        phone: true, email: true, gstin: true, colour: true, logoKey: true,
      },
    }),
  ]);
  if (!party || !letterhead) notFound();

  const listWindow = parseListWindow(await searchParams);
  const scope = { companyId: company.id, centreId: centre.id, partyId: id };

  const [entries, latest, totals] = await Promise.all([
    // No skip/take: the whole window, for the reason in the doc comment above.
    prisma.ledgerEntry.findMany({
      where: { ...scope, ...dateWhere(listWindow) },
      orderBy: [{ date: "asc" }, { seq: "asc" }],
    }),
    prisma.ledgerEntry.findFirst({
      where: scope,
      orderBy: [{ date: "desc" }, { seq: "desc" }],
      select: { runningBalance: true },
    }),
    // Lifetime, not windowed — "how much have we billed this party and how much
    // have they settled" is a question about the whole relationship.
    prisma.ledgerEntry.groupBy({
      by: ["type"],
      where: scope,
      _sum: { amount: true },
    }),
  ]);

  const balance = latest?.runningBalance ?? ZERO;
  const sum = (t: "DEBIT" | "CREDIT") =>
    totals.find((r) => r.type === t)?._sum.amount ?? ZERO;
  const debitTotal = sum("DEBIT");
  const creditTotal = sum("CREDIT");

  // The balance carried into the window, so the first printed row starts from a
  // real opening figure rather than appearing to begin at zero. Derived by
  // walking back from the window's first row: its running balance already
  // includes its own movement, so that movement is subtracted off.
  const firstRow = entries[0];
  const opening = firstRow
    ? firstRow.runningBalance.sub(
        firstRow.type === "DEBIT"
          ? firstRow.amount
          : firstRow.amount.negated()
      )
    : balance;

  return (
    <div
      className="bill-sheet"
      data-company={letterhead.name}
      style={
        letterhead.colour
          ? ({ "--company": letterhead.colour } as React.CSSProperties)
          : undefined
      }
    >
      <PrintToolbar
        backHref={`/ledgers/parties/${party.id}?from=${listWindow.from}&to=${listWindow.to}`}
        backLabel="Back to the statement"
      />

      <div className="bill-paper">
        <PrintHeader
          company={letterhead}
          centreName={centre.name}
          docKind="Statement of Account"
          right={
            <>
              <div className="num text-[13px]">
                <span className="opacity-75">From </span>
                <span className="font-semibold">
                  {fmtDate(listWindow.fromDate)}
                </span>
              </div>
              <div className="num text-[13px]">
                <span className="opacity-75">To </span>
                <span className="font-semibold">
                  {fmtDate(listWindow.toDate)}
                </span>
              </div>
            </>
          }
        />

        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
              Statement for
            </div>
            <div className="text-[15px] font-semibold">{party.name}</div>
            <div className="text-[12px] text-muted">
              {PARTY_TYPE_LABELS[party.type]}
            </div>
            {party.contactInfo && (
              <div className="text-[12px] text-muted">{party.contactInfo}</div>
            )}
          </div>
          <div className="text-[12px] grid gap-0.5">
            <Detail label="Opening balance" value={fmtMoney(opening)} />
            <Detail label="Total debits" value={fmtMoney(debitTotal)} />
            <Detail label="Total credits" value={fmtMoney(creditTotal)} />
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="text-[13px] text-muted py-6">
            No entries in this period.
          </p>
        ) : (
          <table className="bill-table">
            <thead>
              <tr>
                <th className="w-20">Date</th>
                <th>Particulars</th>
                <th className="r">Debit</th>
                <th className="r">Credit</th>
                <th className="r">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="num">{fmtDate(listWindow.fromDate)}</td>
                <td className="opacity-75">Opening balance</td>
                <td className="r num"></td>
                <td className="r num"></td>
                <td className="r num">{fmtMoney(opening)}</td>
              </tr>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="num">{fmtDate(e.date)}</td>
                  <td>{SOURCE_LABELS[e.sourceType] ?? e.sourceType}</td>
                  <td className="r num">
                    {e.type === "DEBIT" ? fmtMoney(e.amount) : ""}
                  </td>
                  <td className="r num">
                    {e.type === "CREDIT" ? fmtMoney(e.amount) : ""}
                  </td>
                  <td className="r num">{fmtMoney(e.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="grid grid-cols-2 gap-6 mt-4">
          <div className="text-[11px] text-muted">
            {/* Signed the same way as every ledger and statement in the app:
                positive is owed to us, negative is owed by us. Spelled out in
                words here because this sheet leaves the building. */}
            Balance shown is the position as at today across all periods, not
            only the range printed above.
          </div>
          <div className="text-[12px] grid gap-0.5">
            <Detail
              label={
                balance.greaterThan(0)
                  ? "Party owes"
                  : balance.lessThan(0)
                    ? "We owe party"
                    : "Balance"
              }
              value={fmtMoney(balance.abs())}
            />
          </div>
        </div>

        <div className="bill-sign">
          <div>Received by</div>
          <div>For {letterhead.legalName ?? letterhead.name}</div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
