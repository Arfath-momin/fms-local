import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { requireReports } from "@/lib/session";
import { getActiveCompany, getCompanies } from "@/lib/company";
import { computeUnion } from "@/lib/report";
import { businessTodayDate, fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { DateField } from "../date-field";

type SearchParams = { from?: string; to?: string; company?: string };

function parseRange(sp: SearchParams) {
  const today = businessTodayDate();
  const from =
    sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)
      ? new Date(sp.from)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to =
    sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? new Date(sp.to) : today;
  return { from, to };
}

function pfCls(v: Prisma.Decimal) {
  return v.greaterThan(0) ? "text-credit" : v.lessThan(0) ? "text-debit" : "";
}

export default async function UnionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireReports();
  const sp = await searchParams;
  const { from, to } = parseRange(sp);

  // One company at a time. BFM and B2B are separate businesses — a figure
  // spanning both is nobody's number — so the screen shows whichever one is
  // selected, defaulting to the company being worked in. The toggle below
  // switches it without disturbing the app-wide company cookie, so looking at
  // B2B's month here does not move the user's entry scope.
  const companies = await getCompanies();
  const active = await getActiveCompany();
  const selected =
    companies.find((c) => c.id === sp.company) ?? active ?? companies[0];

  const u = await computeUnion(from, to, selected?.id ?? null);

  const now = businessTodayDate();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => toInputDate(d);
  const link = (p: { from: string; to: string; company?: string }) => {
    const params = new URLSearchParams({ from: p.from, to: p.to });
    if (p.company) params.set("company", p.company);
    return `/union?${params}`;
  };
  const presets = [
    { label: "Today", from: iso(now), to: iso(now) },
    { label: "This month", from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) },
    { label: "This year", from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(new Date(Date.UTC(y, 11, 31))) },
  ];

  return (
    <div className="max-w-4xl">
      <div className="flex items-end justify-between mb-3 flex-wrap gap-3">
        <div>
          <h1 className="heading text-xl font-semibold">Union Dashboard</h1>
          <p className="text-muted text-[13px]">
            {selected?.name ?? "No company"} · every centre together ·{" "}
            {fmtDate(from)} → {fmtDate(to)}
          </p>
        </div>
        <form method="GET" className="flex items-end gap-2">
          <input type="hidden" name="company" value={selected?.id ?? ""} />
          <div>
            <label htmlFor="from" className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">From</label>
            <DateField id="from" name="from" defaultValue={toInputDate(from)} className="border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
          </div>
          <div>
            <label htmlFor="to" className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">To</label>
            <DateField id="to" name="to" defaultValue={toInputDate(to)} className="border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
          </div>
          <button type="submit" className="bg-accent text-white px-3 py-1.5 text-[13px] font-semibold">Show</button>
        </form>
      </div>

      <div className="flex gap-2 mb-5 flex-wrap items-center">
        {presets.map((p) => (
          <Link
            key={p.label}
            href={link({ from: p.from, to: p.to, company: selected?.id })}
            className="border border-line-strong bg-surface px-3 py-1 text-[12px] font-semibold hover:border-accent"
          >
            {p.label}
          </Link>
        ))}
        {companies.length > 1 && (
          <span className="flex gap-2 ml-auto">
            {companies.map((c) => (
              <Link
                key={c.id}
                href={link({ from: iso(from), to: iso(to), company: c.id })}
                aria-current={c.id === selected?.id ? "page" : undefined}
                className={
                  "border px-3 py-1 text-[12px] font-semibold " +
                  (c.id === selected?.id
                    ? "bg-accent text-white border-accent"
                    : "border-line-strong bg-surface hover:border-accent")
                }
              >
                {c.name}
              </Link>
            ))}
          </span>
        )}
      </div>

      {/* Company total */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Stat label="Total Sale" value={u.total.sale} cls="text-credit" />
        <Stat label="Total Purchase" value={u.total.purchase} cls="text-debit" />
        <Stat label="Total Expense" value={u.total.expense} cls="text-debit" />
        <Stat label="Total Profit" value={u.total.profit} cls={pfCls(u.total.profit)} strong />
      </div>

      {/* Per company, with centre breakdown */}
      {u.companies.map((c) => (
        <div key={c.companyId} className="mb-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="heading text-[15px] font-semibold">{c.companyName}</h2>
            <span className={`num text-[15px] font-bold ${pfCls(c.profit)}`}>
              Profit {fmtMoney(c.profit)}
            </span>
          </div>
          <div className="border border-line-strong bg-surface">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Centre</th>
                  <th className="num-col">Purchase</th>
                  <th className="num-col">Expense</th>
                  <th className="num-col">Sale</th>
                </tr>
              </thead>
              <tbody>
                {c.centres.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-muted text-[13px] px-4 py-3">
                      No centres.
                    </td>
                  </tr>
                ) : (
                  c.centres.map((ce) => (
                    <tr key={ce.centreId}>
                      <td className="font-medium">{ce.centreName}</td>
                      <td className="num-col num text-debit">{fmtMoney(ce.purchase)}</td>
                      <td className="num-col num text-debit">{fmtMoney(ce.expense)}</td>
                      <td className="num-col num text-credit">{fmtMoney(ce.sale)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong font-semibold">
                  <td className="text-right">Company total</td>
                  <td className="num-col num text-debit">{fmtMoney(c.purchase)}</td>
                  <td className="num-col num text-debit">{fmtMoney(c.expense)}</td>
                  <td className="num-col num text-credit">{fmtMoney(c.sale)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
      <p className="text-muted text-[12px]">
        Profit = Sale − (Purchase + Expense). Per-centre profit is not shown —
        purchase and sale are split across centres, so only the company figure
        is meaningful. Use the toggle above to read the other company.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  cls,
  strong,
}: {
  label: string;
  value: Prisma.Decimal;
  cls?: string;
  strong?: boolean;
}) {
  return (
    <div className={`border bg-surface px-4 py-3 ${strong ? "border-line-strong" : "border-line"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">{label}</div>
      <div className={`num ${strong ? "text-2xl" : "text-xl"} font-bold mt-1 ${cls ?? ""}`}>
        {fmtMoney(value)}
      </div>
    </div>
  );
}
