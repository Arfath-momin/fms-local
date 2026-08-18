import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { LedgerSourceType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { ledgerSectionFor, PARTY_TYPE_LABELS } from "@/lib/party";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import { DateWindow, Pager } from "../../../list-controls";
import { NoCentreNotice } from "../../../no-centre";
import { SettleLink } from "../../settle-link";

const SOURCE_LABELS: Record<LedgerSourceType, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
  COMMISSION: "Commission",
};

export default async function PartyStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  // Auditors read statements but never post a voucher from one.
  const mayEnter = canEnter(session.role);
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;
  const { id } = await params;

  const party = await prisma.party.findUnique({ where: { id } });
  if (!party) notFound();

  const listWindow = parseListWindow(await searchParams);
  const scope = { companyId: company.id, centreId: centre.id, partyId: id };
  const where = { ...scope, ...dateWhere(listWindow) };

  // The statement is windowed, but the headline balance must not be: it is what
  // the party owes *now*, not at the end of whichever month is on screen. So it
  // comes from the newest entry overall rather than from the last row rendered.
  const [entries, total, latest, totals] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ date: "asc" }, { seq: "asc" }],
      skip: listWindow.skip,
      take: listWindow.take,
    }),
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findFirst({
      where: scope,
      orderBy: [{ date: "desc" }, { seq: "desc" }],
      select: { runningBalance: true },
    }),
    // Lifetime totals, not windowed — "how much have we billed this party and
    // how much have they settled" is a question about the whole relationship,
    // not about whichever month happens to be on screen. Grouped in Postgres,
    // so it stays one indexed aggregate however long the statement gets.
    prisma.ledgerEntry.groupBy({
      by: ["type"],
      where: scope,
      _sum: { amount: true },
    }),
  ]);

  // Resolve source links for drill-down: each ledger entry's sourceId points at
  // its own voucher page (purchase / sale / expense / settlement).
  const sourceIds = [...new Set(entries.map((e) => e.sourceId))];
  const [sales, purchases, expenses, settlements] = await Promise.all([
    prisma.sale.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true },
    }),
    // The boats come back with the purchase so the statement can name the
    // vessels on each line — the whole point of moving the ledger to the group.
    // Bounded by the page size, so this stays one indexed IN(…) read however
    // long the statement is.
    prisma.purchase.findMany({
      where: { id: { in: sourceIds } },
      select: {
        id: true,
        boat: { select: { name: true } },
        lines: { select: { boat: { select: { name: true } } } },
      },
    }),
    prisma.expense.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true },
    }),
    prisma.settlement.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, kind: true },
    }),
  ]);

  // One Society bill covers several vessels, so the column lists whichever
  // ones this bill names, de-duplicated. `p.boat` is the header field older
  // purchases used before boats moved onto the line.
  const boatBySource = new Map(
    purchases
      .map((p) => {
        const fromLines = [
          ...new Set(
            p.lines.map((l) => l.boat?.name).filter((n): n is string => !!n)
          ),
        ];
        const label = fromLines.length > 0 ? fromLines.join(", ") : p.boat?.name;
        return [p.id, label] as const;
      })
      .filter((e): e is readonly [string, string] => !!e[1])
  );
  // A purchase party's ledger is the only place a Boat column earns its keep;
  // a vendor or buyer statement would just show an empty column on every row.
  const showBoat = party.type === "PURCHASE_GROUP";
  const section = ledgerSectionFor(party.type);
  const links = new Map<string, string>();
  for (const p of purchases) links.set(p.id, `/vouchers/purchases/${p.id}`);
  for (const e of expenses) links.set(e.id, `/vouchers/expenses/${e.id}`);
  for (const s of sales) links.set(s.id, `/vouchers/sales/${s.id}`);
  for (const st of settlements)
    links.set(
      st.id,
      `/vouchers/${st.kind === "PAYMENT" ? "payments" : "receipts"}/${st.id}`
    );

  const balance = latest?.runningBalance ?? new Prisma.Decimal(0);

  // DEBIT is what we have billed the party (sales); CREDIT is what they have
  // settled plus anything we owe them (purchases, expenses). Outstanding is
  // the difference, which is exactly the running balance.
  const ZERO = new Prisma.Decimal(0);
  const sumOf = (t: "DEBIT" | "CREDIT") =>
    totals.find((g) => g.type === t)?._sum.amount ?? ZERO;
  const totalDebit = sumOf("DEBIT");
  const totalCredit = sumOf("CREDIT");

  return (
    <div className="max-w-3xl">
      {/* Back to the section this party belongs to, not to a flat list —
          whoever opened this statement came from one of the sections. */}
      <Link
        href={section.href}
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← {section.label}
      </Link>
      <div className="flex items-end justify-between mt-1 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">{party.name}</h1>
          <p className="text-muted text-[13px]">
            {PARTY_TYPE_LABELS[party.type]} · statement for {company.name} ·{" "}
            {centre.name}
          </p>
          <div className="mt-1 flex items-center gap-3">
            <a
              href={`/ledgers/parties/${party.id}/export`}
              className="text-accent text-[12px] underline underline-offset-2"
            >
              Export statement (CSV)
            </a>
            {/* CSV is for a spreadsheet; this is the statement as a document —
                the one printable that regularly leaves the building, handed to
                a party querying what they owe. Carries the date window on
                screen, so both links cover the same period. */}
            <Link
              href={`/ledgers/parties/${party.id}/print?from=${listWindow.from}&to=${listWindow.to}`}
              className="text-accent text-[12px] underline underline-offset-2"
            >
              Print statement
            </Link>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] uppercase tracking-wide text-muted font-semibold">
            Outstanding Balance
          </div>
          <div
            className={`num text-xl font-bold ${
              balance.greaterThan(0)
                ? "text-debit"
                : balance.lessThan(0)
                  ? "text-credit"
                  : ""
            }`}
          >
            {fmtMoney(balance)}
          </div>
          {balance.greaterThan(0) && (
            <div className="text-debit text-[12px]">owes us</div>
          )}
          {balance.lessThan(0) && (
            <div className="text-credit text-[12px]">we owe them</div>
          )}
          {/* Settle straight from the statement — the balance above is exactly
              the figure being acted on, so this is where the decision is made. */}
          {mayEnter && (
            <SettleLink
              partyId={party.id}
              partyType={party.type}
              balance={balance}
              className="inline-block mt-1 text-[12px]"
            />
          )}
        </div>
      </div>

      {/* Lifetime position with this party, independent of the date window
          below — what we billed, what came back, and what is still open. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Summary label="Total billed" value={totalDebit} cls="text-debit" />
        <Summary label="Total settled" value={totalCredit} cls="text-credit" />
        <Summary
          label="Receivable"
          value={balance.greaterThan(0) ? balance : ZERO}
          cls={balance.greaterThan(0) ? "text-debit" : "text-muted"}
        />
        <Summary
          label="Payable"
          value={balance.lessThan(0) ? balance.negated() : ZERO}
          cls={balance.lessThan(0) ? "text-credit" : "text-muted"}
        />
      </div>

      <DateWindow
        basePath={`/ledgers/parties/${party.id}`}
        window={listWindow}
      />

      {entries.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No transactions with {party.name} in {company.name} between{" "}
          {listWindow.from} and {listWindow.to}. Widen the dates above to see
          earlier activity.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Particulars</th>
                {showBoat && <th>Boat</th>}
                <th className="num-col">Debit</th>
                <th className="num-col">Credit</th>
                <th className="num-col">Balance</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const href = links.get(e.sourceId);
                const label = SOURCE_LABELS[e.sourceType];
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td>
                      {href ? (
                        <Link
                          href={href}
                          className="text-accent underline underline-offset-2"
                        >
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </td>
                    {showBoat && (
                      <td>
                        {boatBySource.get(e.sourceId) ?? (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    )}
                    <td className="num-col num text-debit">
                      {e.type === "DEBIT" ? fmtMoney(e.amount) : ""}
                    </td>
                    <td className="num-col num text-credit">
                      {e.type === "CREDIT" ? fmtMoney(e.amount) : ""}
                    </td>
                    <td className="num-col num font-semibold">
                      {fmtMoney(e.runningBalance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entries.length > 0 && (
        <Pager
          basePath={`/ledgers/parties/${party.id}`}
          window={listWindow}
          total={total}
        />
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  cls,
}: {
  label: string;
  value: Prisma.Decimal;
  cls?: string;
}) {
  return (
    <div className="border border-line bg-surface px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
        {label}
      </div>
      <div className={`num text-[15px] font-bold mt-0.5 ${cls ?? ""}`}>
        {fmtMoney(value)}
      </div>
    </div>
  );
}
