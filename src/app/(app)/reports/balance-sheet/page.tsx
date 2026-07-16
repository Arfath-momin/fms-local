import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { computeBalanceSheet, AGED_LOSS_DAYS } from "@/lib/report";
import { fmtDate, fmtKg, fmtMoney, toInputDate } from "@/lib/format";

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireSession();
  const company = await getActiveCompany();

  const raw = (await searchParams).date;
  const asOf =
    raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(raw)
      : new Date(toInputDate(new Date()));

  const bs = await computeBalanceSheet(company.id, asOf);

  return (
    <div className="max-w-2xl">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Balance Sheet</h1>
          <p className="text-muted text-[13px]">
            {company.name} · as of {fmtDate(asOf)}
          </p>
        </div>
        <form method="GET" className="flex items-center gap-2">
          <input
            name="date"
            type="date"
            defaultValue={toInputDate(asOf)}
            className="border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="bg-accent text-white px-3 py-1.5 text-[13px] font-semibold"
          >
            Show
          </button>
        </form>
      </div>

      <div className="border border-line-strong bg-surface">
        <div className="px-4 py-2 border-b border-line-strong bg-[#edece7]">
          <span className="heading text-[13px] font-semibold uppercase tracking-wide">
            Assets
          </span>
        </div>
        <table className="ledger-table">
          <tbody>
            <tr>
              <td className="font-semibold">
                <Link href="/reports/stock" className="text-accent underline underline-offset-2">
                  Stock in hand
                </Link>
                <span className="text-muted font-normal"> (at weighted-average cost)</span>
              </td>
              <td className="num-col num font-semibold">{fmtMoney(bs.stockValue)}</td>
            </tr>
            {bs.stockRows.map((r) => (
              <tr key={r.fishType}>
                <td className="pl-8 text-muted">
                  {r.fishType} · {fmtKg(r.qty)}
                </td>
                <td className="num-col num text-muted">{fmtMoney(r.value)}</td>
              </tr>
            ))}
            <tr>
              <td className="font-semibold">
                <Link href="/ledgers/parties" className="text-accent underline underline-offset-2">
                  Receivables
                </Link>
                <span className="text-muted font-normal"> (parties owing us)</span>
              </td>
              <td className="num-col num font-semibold">{fmtMoney(bs.receivables)}</td>
            </tr>
            {bs.agedReceivables.greaterThan(0) && (
              <tr>
                <td className="pl-8 text-debit">
                  of which outstanding over {AGED_LOSS_DAYS} days (treated as
                  loss in P&amp;L)
                </td>
                <td className="num-col num text-debit">
                  {fmtMoney(bs.agedReceivables)}
                </td>
              </tr>
            )}
            <tr>
              <td className="font-semibold">
                <Link href="/ledgers/owner-reserve" className="text-accent underline underline-offset-2">
                  Owner reserve
                </Link>
                <span className="text-muted font-normal"> (held with market owner)</span>
              </td>
              <td className="num-col num font-semibold">{fmtMoney(bs.ownerReserve)}</td>
            </tr>
          </tbody>
        </table>

        <div className="px-4 py-2 border-y border-line-strong bg-[#edece7]">
          <span className="heading text-[13px] font-semibold uppercase tracking-wide">
            Liabilities
          </span>
        </div>
        <table className="ledger-table">
          <tbody>
            <tr>
              <td className="font-semibold">
                Payables <span className="text-muted font-normal">(we owe parties)</span>
              </td>
              <td className="num-col num font-semibold text-debit">
                {fmtMoney(bs.payables)}
              </td>
            </tr>
            <tr>
              <td className="heading font-semibold text-[15px]">Net position</td>
              <td
                className={`num-col num font-bold text-[15px] ${
                  bs.netPosition.greaterThan(0)
                    ? "text-credit"
                    : bs.netPosition.lessThan(0)
                      ? "text-debit"
                      : ""
                }`}
              >
                {fmtMoney(bs.netPosition)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-muted text-[12px] mt-3 max-w-xl">
        A working snapshot, not a statutory statement: stock at cost,
        receivables and payables from party ledgers, and the market owner
        reserve. Cash is not tracked in this system.
      </p>
    </div>
  );
}
