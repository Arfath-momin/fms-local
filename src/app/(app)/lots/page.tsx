import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { canAdminister, canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { computeLotProfits } from "@/lib/report";
import { fmtDate, fmtMoney } from "@/lib/format";
import { OVERHEAD_LOT_LABEL } from "@/lib/lot";
import { NoCentreNotice } from "../no-centre";
import { LotActionsCell } from "./lot-actions-cell";

const ZERO = new Prisma.Decimal(0);

/**
 * Profit per consignment — the screen the whole lot mechanism exists for.
 *
 * The Profit report answers "what did August make". This answers "what did
 * Monday's fish make", which is the question the merchant actually asks, and
 * the one a date range cannot answer while the buying and the selling of
 * different days overlap.
 */
export default async function LotsPage() {
  const session = await requireSession();
  const mayClose = canEnter(session.role);
  const mayReopen = canAdminister(session.role);

  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const lots = await prisma.lot.findMany({
    where: { companyId: company.id, centreId: centre.id },
    orderBy: [{ kind: "asc" }, { openedOn: "desc" }],
    select: {
      id: true,
      code: true,
      kind: true,
      openedOn: true,
      closedAt: true,
    },
  });

  // One grouped pass over every lot on screen, not a query per row.
  const profits = await computeLotProfits(
    company.id,
    centre.id,
    lots.map((l) => l.id)
  );

  const open = lots.filter((l) => l.kind === "CONSIGNMENT" && !l.closedAt);
  const closed = lots.filter((l) => l.kind === "CONSIGNMENT" && l.closedAt);
  const overhead = lots.filter((l) => l.kind === "OVERHEAD");

  const openProfit = open.reduce(
    (a, l) => a.add(profits.get(l.id)?.profit ?? ZERO),
    ZERO
  );
  const closedProfit = closed.reduce(
    (a, l) => a.add(profits.get(l.id)?.profit ?? ZERO),
    ZERO
  );

  return (
    <div className="max-w-4xl">
      <h1 className="heading text-xl font-semibold mb-1">Lots</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · {centre.name} · each day&apos;s fish with everything it
        cost and everything it earned. A lot opens by itself on the day&apos;s
        first purchase; close it once that fish is sold out.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Tile label="Open lots" value={String(open.length)} />
        <Tile
          label="Profit, open lots"
          value={fmtMoney(openProfit)}
          cls={profitCls(openProfit)}
          sub="still selling — not final"
        />
        <Tile
          label="Profit, closed lots"
          value={fmtMoney(closedProfit)}
          cls={profitCls(closedProfit)}
          sub="sold out and settled"
          strong
        />
      </div>

      <Section
        title="Open"
        blurb="Still selling. These are the lots a sale or expense can be entered against."
        lots={open}
        profits={profits}
        mayClose={mayClose}
        mayReopen={mayReopen}
        empty="No lot is open. The next purchase entered will open one."
      />

      <Section
        title="Closed"
        blurb="Sold out. Their profit is final, and nothing new can be entered against them."
        lots={closed}
        profits={profits}
        mayClose={mayClose}
        mayReopen={mayReopen}
        empty="Nothing closed yet."
      />

      {overhead.length > 0 && (
        <Section
          title={OVERHEAD_LOT_LABEL}
          blurb="Rent and other standing costs that belong to no single day's fish. Kept apart so they cannot distort one consignment's profit."
          lots={overhead}
          profits={profits}
          mayClose={mayClose}
          mayReopen={mayReopen}
          empty="No overhead costs recorded."
        />
      )}

      <p className="text-muted text-[12px] mt-4">
        Lots are per centre. The{" "}
        <Link
          href="/reports/profit"
          className="text-accent underline underline-offset-2"
        >
          Profit report
        </Link>{" "}
        still answers the same question by date range, unchanged — use it for a
        month or a year, and this for one catch.
      </p>
    </div>
  );
}

const profitCls = (v: Prisma.Decimal) =>
  v.greaterThan(0) ? "text-credit" : v.lessThan(0) ? "text-debit" : "";

type LotRow = {
  id: string;
  code: string;
  kind: "CONSIGNMENT" | "OVERHEAD";
  openedOn: Date;
  closedAt: Date | null;
};

function Section({
  title,
  blurb,
  lots,
  profits,
  mayClose,
  mayReopen,
  empty,
}: {
  title: string;
  blurb: string;
  lots: LotRow[];
  profits: Map<string, { sale: Prisma.Decimal; purchase: Prisma.Decimal; expense: Prisma.Decimal; profit: Prisma.Decimal }>;
  mayClose: boolean;
  mayReopen: boolean;
  empty: string;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 border-b border-line-strong pb-1">
        <h2 className="heading text-[16px] font-semibold">{title}</h2>
        <p className="text-muted text-[12px]">{blurb}</p>
      </div>

      {lots.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3">
          {empty}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface overflow-x-auto">
          <table className="ledger-table min-w-[640px]">
            <thead>
              <tr>
                <th>Lot</th>
                <th>Opened</th>
                <th className="num-col">Purchases</th>
                <th className="num-col">Expenses</th>
                <th className="num-col">Sales</th>
                <th className="num-col">Profit</th>
                {mayClose && <th className="w-24"></th>}
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => {
                const p = profits.get(l.id);
                const profit = p?.profit ?? ZERO;
                const isOverhead = l.kind === "OVERHEAD";
                return (
                  <tr key={l.id}>
                    <td className="font-medium">
                      {isOverhead ? OVERHEAD_LOT_LABEL : l.code}
                    </td>
                    <td className="text-muted whitespace-nowrap">
                      {isOverhead ? "—" : fmtDate(l.openedOn)}
                    </td>
                    <td className="num-col num">
                      {fmtMoney(p?.purchase ?? ZERO)}
                    </td>
                    <td className="num-col num">
                      {fmtMoney(p?.expense ?? ZERO)}
                    </td>
                    <td className="num-col num">{fmtMoney(p?.sale ?? ZERO)}</td>
                    {/* Overheads have no sales, so their "profit" is just the
                        cost — shown as a negative rather than dressed up. */}
                    <td className={`num-col num font-semibold ${profitCls(profit)}`}>
                      {fmtMoney(profit)}
                    </td>
                    {mayClose && (
                      <td>
                        <LotActionsCell
                          lotId={l.id}
                          code={l.code}
                          closed={l.closedAt !== null}
                          isOverhead={isOverhead}
                          mayReopen={mayReopen}
                        />
                      </td>
                    )}
                  </tr>
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
  cls = "",
  sub,
  strong,
}: {
  label: string;
  value: string;
  cls?: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`border bg-surface px-4 py-3 ${
        strong ? "border-line-strong" : "border-line"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
        {label}
      </div>
      <div className={`num text-lg font-bold ${cls}`}>{value}</div>
      {sub && <div className="text-muted text-[12px]">{sub}</div>}
    </div>
  );
}
