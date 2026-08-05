import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
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
 * One section's ledgers. Every row links straight to the statement, which is
 * the only place a balance can actually be read — the list exists to get you
 * there in one click rather than to be scanned for numbers.
 */
export function LedgerTable({
  rows,
  showType = false,
  empty,
}: {
  rows: LedgerRow[];
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
    <div className="border border-line-strong bg-surface">
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
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-medium">
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
    <div className="flex items-end justify-between mb-4">
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
