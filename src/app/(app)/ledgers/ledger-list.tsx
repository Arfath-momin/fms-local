import { Fragment } from "react";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import type { LedgerRow } from "@/lib/ledger-index";
import { PARTY_TYPE_LABELS } from "@/lib/party";
import { fmtMoney } from "@/lib/format";

/** Debit red when the party owes us, credit green when we owe them. */
export function balanceClass(balance: Prisma.Decimal): string {
  if (balance.greaterThan(0)) return "text-debit";
  if (balance.lessThan(0)) return "text-credit";
  return "";
}

/**
 * A run of rows under one heading, with its own subtotal.
 *
 * `label` null prints the rows bare, for the standing accounts that head the
 * purchase list — a "Society" heading above a single row called Society tells
 * the reader nothing they cannot already see.
 */
export type LedgerGroup = { label: string | null; rows: LedgerRow[] };

/**
 * One section's ledgers. Every row links straight to the statement, which is
 * the only place a balance can actually be read — the list exists to get you
 * there in one click rather than to be scanned for numbers.
 *
 * `groups` splits those rows under headings while keeping ONE table, so the
 * balances stay in a single aligned column. Separate tables per group would
 * each size their own columns, and the figures a merchant is comparing would
 * no longer line up.
 */
export function LedgerTable({
  rows,
  groups,
  showType = false,
  empty,
}: {
  rows: LedgerRow[];
  /** Sectioned rendering; `rows` is still what decides emptiness. */
  groups?: LedgerGroup[];
  /** Show the party kind — worth it when a section mixes several. */
  showType?: boolean;
  empty: string;
}) {
  if (rows.length === 0)
    return (
      <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3">
        {empty}
      </p>
    );

  return (
    <div className="border border-line-strong bg-surface overflow-x-auto">
      <table className="ledger-table">
        <thead>
          <tr>
            <th>Party</th>
            {showType && <th>Type</th>}
            <th className="num-col">Entries</th>
            <th className="num-col">Balance</th>
          </tr>
        </thead>
        <tbody>
          {(groups ?? [{ label: null, rows }]).map((g, gi) => {
            const subtotal = g.rows.reduce(
              (a, r) => a.add(r.balance),
              new Prisma.Decimal(0)
            );
            return (
              <Fragment key={g.label ?? `_${gi}`}>
                {g.label && (
                  <tr className="bg-line/40">
                    <td
                      className="text-[11px] uppercase tracking-wide text-muted font-semibold"
                      colSpan={showType ? 3 : 2}
                    >
                      {g.label}
                      <span className="ml-2 normal-case tracking-normal">
                        {g.rows.length}{" "}
                        {g.rows.length === 1 ? "party" : "parties"}
                      </span>
                    </td>
                    {/* The section's own position, in the same column as the
                        rows it covers — what we owe all the private sellers
                        together is a figure that gets asked for on its own. */}
                    <td
                      className={`num-col num font-semibold ${balanceClass(subtotal)}`}
                    >
                      {fmtMoney(subtotal)}
                    </td>
                  </tr>
                )}
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td className={`font-medium ${g.label ? "pl-6" : ""}`}>
                      <Link
                        href={`/ledgers/parties/${r.id}`}
                        className="text-accent underline underline-offset-2"
                      >
                        {r.name}
                      </Link>
                    </td>
                    {showType && <td>{PARTY_TYPE_LABELS[r.type]}</td>}
                    <td className="num-col num text-muted">{r.entries}</td>
                    <td
                      className={`num-col num font-semibold ${balanceClass(r.balance)}`}
                    >
                      {fmtMoney(r.balance)}
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The heading block every ledger section shares: title, scope line, total. */
export function SectionHeader({
  title,
  scope,
  totalLabel,
  total,
  totalClass,
}: {
  title: string;
  scope: string;
  totalLabel: string;
  total: Prisma.Decimal;
  totalClass?: string;
}) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
      <div>
        <h1 className="heading text-xl font-semibold">{title}</h1>
        <p className="text-muted text-[13px]">{scope}</p>
      </div>
      <div className="text-right">
        <div className="text-[12px] uppercase tracking-wide text-muted font-semibold">
          {totalLabel}
        </div>
        <div className={`num text-xl font-bold ${totalClass ?? ""}`}>
          {fmtMoney(total)}
        </div>
      </div>
    </div>
  );
}
