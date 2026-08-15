import { Fragment } from "react";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import type { PartyType } from "@/generated/prisma/enums";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { sectionLedgers, type LedgerRow } from "@/lib/ledger-index";
import {
  EXPENSE_LEDGER_TYPES,
  LEDGER_PARTY_TYPES,
  PURCHASE_LEDGER_TYPES,
  SALE_LEDGER_TYPES,
} from "@/lib/party";
import { fmtMoney } from "@/lib/format";
import { NoCentreNotice } from "../../no-centre";
import { SettleLink } from "../settle-link";

const ZERO = new Prisma.Decimal(0);

/**
 * Every open balance, split by direction.
 *
 * The flat list of parties with plus and minus signs made the two questions
 * anyone actually asks — who owes us, and who do we owe — something you had to
 * work out for yourself, sign by sign, down a mixed column. These are opposite
 * obligations and they belong in opposite halves of the page.
 *
 * Within each half the parties are grouped the same way the Ledgers menu groups
 * them, so the vocabulary matches what is clicked through every day.
 */
const GROUPS: { key: string; label: string; types: PartyType[] }[] = [
  { key: "purchase", label: "Purchase Parties", types: PURCHASE_LEDGER_TYPES },
  { key: "sale", label: "Sale Ledgers", types: SALE_LEDGER_TYPES },
  { key: "expense", label: "Expense Vendors", types: EXPENSE_LEDGER_TYPES },
  { key: "commission", label: "Commission", types: ["COMMISSION"] },
];

const groupOf = (type: PartyType) =>
  GROUPS.find((g) => g.types.includes(type)) ?? GROUPS[GROUPS.length - 1];

type Side = { groups: { label: string; rows: LedgerRow[] }[]; total: Prisma.Decimal };

/** Bucket one direction's rows into the menu's sections, biggest debt first. */
function organise(rows: LedgerRow[]): Side {
  const byGroup = new Map<string, LedgerRow[]>();
  let total = ZERO;

  for (const r of rows) {
    total = total.add(r.balance.abs());
    const g = groupOf(r.type);
    const list = byGroup.get(g.key);
    if (list) list.push(r);
    else byGroup.set(g.key, [r]);
  }

  const groups = GROUPS.filter((g) => byGroup.has(g.key)).map((g) => ({
    label: g.label,
    // Largest first: the biggest open amount is the one that needs chasing or
    // settling, and it should not have to be found alphabetically.
    rows: byGroup
      .get(g.key)!
      .sort((a, b) => b.balance.abs().comparedTo(a.balance.abs())),
  }));

  return { groups, total };
}

export default async function OutstandingPage() {
  const session = await requireSession();
  // Auditors read this screen but never settle from it.
  const mayEnter = canEnter(session.role);
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  // One read over every ledger type — the same three queries the All Ledgers
  // page already runs. The split below is over an array of tens of rows, so it
  // costs nothing that a database round trip would notice.
  const rows = await sectionLedgers(
    { companyId: company.id, centreId: centre.id },
    LEDGER_PARTY_TYPES
  );

  // Sign convention from src/lib/ledger.ts: positive = they owe us, negative =
  // we owe them.
  const owedToUs = organise(rows.filter((r) => r.balance.greaterThan(0)));
  const owedByUs = organise(rows.filter((r) => r.balance.lessThan(0)));
  const settled = rows.filter((r) => r.balance.isZero()).length;
  const net = owedToUs.total.sub(owedByUs.total);

  return (
    <div className="max-w-3xl">
      <Link
        href="/ledgers"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Ledgers
      </Link>
      <h1 className="heading text-xl font-semibold mt-1 mb-1">Outstanding</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · {centre.name} · every account with money still open.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Tile
          label="They owe us"
          value={owedToUs.total}
          cls="text-debit"
          sub={`${count(owedToUs)} account${count(owedToUs) === 1 ? "" : "s"}`}
        />
        <Tile
          label="We owe them"
          value={owedByUs.total}
          cls="text-credit"
          sub={`${count(owedByUs)} account${count(owedByUs) === 1 ? "" : "s"}`}
        />
        <Tile
          label="Net position"
          value={net.abs()}
          cls={net.greaterThan(0) ? "text-debit" : net.lessThan(0) ? "text-credit" : ""}
          sub={
            net.greaterThan(0)
              ? "in our favour"
              : net.lessThan(0)
                ? "against us"
                : "square"
          }
          strong
        />
      </div>

      <Half
        title="Who owes us"
        blurb="Buyers and agents with bills still to settle."
        side={owedToUs}
        cls="text-debit"
        empty="Nobody owes us anything here."
        mayEnter={mayEnter}
      />

      <Half
        title="Who we owe"
        blurb="Suppliers and vendors waiting to be paid."
        side={owedByUs}
        cls="text-credit"
        empty="We owe nobody here."
        mayEnter={mayEnter}
      />

      <p className="text-muted text-[12px] mt-4">
        {settled > 0 && (
          <>
            {settled} settled account{settled === 1 ? "" : "s"} with a zero
            balance {settled === 1 ? "is" : "are"} not listed.{" "}
          </>
        )}
        Balances are for this centre only — the same party can carry a separate
        balance in another one.
      </p>
    </div>
  );
}

const count = (s: Side) => s.groups.reduce((n, g) => n + g.rows.length, 0);

function Half({
  title,
  blurb,
  side,
  cls,
  empty,
  mayEnter,
}: {
  title: string;
  blurb: string;
  side: Side;
  cls: string;
  empty: string;
  mayEnter: boolean;
}) {
  return (
    <section className="mb-6">
      <div className="flex items-end justify-between gap-4 mb-2 border-b border-line-strong pb-1">
        <div>
          <h2 className="heading text-[16px] font-semibold">{title}</h2>
          <p className="text-muted text-[12px]">{blurb}</p>
        </div>
        <div className={`num text-[17px] font-bold ${cls}`}>
          {fmtMoney(side.total)}
        </div>
      </div>

      {side.groups.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3">
          {empty}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <tbody>
              {side.groups.map((g) => {
                const subtotal = g.rows.reduce(
                  (a, r) => a.add(r.balance.abs()),
                  ZERO
                );
                return (
                  <Fragment key={g.label}>
                    <tr className="bg-background">
                      <th
                        colSpan={2}
                        className="text-left text-[11px] uppercase tracking-wide text-muted font-semibold"
                      >
                        {g.label}
                      </th>
                      <th className={`num-col num text-[12px] ${cls}`}>
                        {fmtMoney(subtotal)}
                      </th>
                      {mayEnter && <th />}
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="font-medium">
                          <Link
                            href={`/ledgers/parties/${r.id}`}
                            className="text-accent underline underline-offset-2"
                          >
                            {r.name}
                          </Link>
                        </td>
                        <td className="num-col num text-muted">
                          {r.entries} entr{r.entries === 1 ? "y" : "ies"}
                        </td>
                        <td className={`num-col num font-semibold ${cls}`}>
                          {fmtMoney(r.balance.abs())}
                        </td>
                        {/* The whole point of the screen: read the debt, settle
                            it, without retyping the name into a picker. */}
                        {mayEnter && (
                          <td className="text-[12px]">
                            <SettleLink
                              partyId={r.id}
                              partyType={r.type}
                              balance={r.balance}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  cls,
  sub,
  strong,
}: {
  label: string;
  value: Prisma.Decimal;
  cls?: string;
  sub: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`border bg-surface px-4 py-3 ${strong ? "border-line-strong" : "border-line"}`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
        {label}
      </div>
      <div className={`num text-xl font-bold mt-1 ${cls ?? ""}`}>
        {fmtMoney(value)}
      </div>
      <div className="text-muted text-[12px]">{sub}</div>
    </div>
  );
}
