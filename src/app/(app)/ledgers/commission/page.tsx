import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { COMMISSION_PARTY_NAME } from "@/lib/settlement";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import { DateWindow, Pager } from "../../list-controls";
import { NoCentreNotice } from "../../no-centre";

const ZERO = new Prisma.Decimal(0);

/**
 * The 2% commission earned on Market sales.
 *
 * This is an ordinary party statement pointed at the house's own commission
 * account, which is why there is no bespoke commission table: the entries are
 * posted by the sale action through the same ledger machinery as everything
 * else, so the running balance, the date window and the recompute-on-edit
 * behaviour all come for free and cannot drift from the rest of the system.
 */
export default async function CommissionLedgerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const party = await prisma.party.findUnique({
    where: { name_type: { name: COMMISSION_PARTY_NAME, type: "COMMISSION" } },
    select: { id: true },
  });

  const listWindow = parseListWindow(await searchParams);

  // No commission has ever been posted, so the account does not exist yet.
  if (!party) {
    return (
      <Shell company={company.name} centre={centre.name} window={listWindow}>
        <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3 max-w-lg">
          No commission recorded yet. It accrues automatically at 2% of the
          Total Bill each time a Market sale is saved.
        </p>
      </Shell>
    );
  }

  const scope = {
    companyId: company.id,
    centreId: centre.id,
    partyId: party.id,
  };
  const where = { ...scope, ...dateWhere(listWindow) };

  const [entries, total, lifetime, saleIds] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ date: "asc" }, { seq: "asc" }],
      skip: listWindow.skip,
      take: listWindow.take,
    }),
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.aggregate({ where: scope, _sum: { amount: true } }),
    prisma.ledgerEntry.findMany({
      where,
      select: { sourceId: true },
    }),
  ]);

  // Resolve the originating bill numbers in one query rather than per row.
  const sales = await prisma.sale.findMany({
    where: { id: { in: saleIds.map((s) => s.sourceId) } },
    select: { id: true, billNo: true, party: { select: { name: true } } },
  });
  const saleById = new Map(sales.map((s) => [s.id, s]));

  const windowTotal = entries.reduce((a, e) => a.add(e.amount), ZERO);

  return (
    <Shell company={company.name} centre={centre.name} window={listWindow}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <Stat label="Commission earned (all time)" value={lifetime._sum.amount ?? ZERO} />
        <Stat label="In this window" value={windowTotal} />
      </div>

      {entries.length === 0 ? (
        <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3 max-w-lg">
          No commission between {listWindow.from} and {listWindow.to}.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Transaction</th>
                <th className="num-col">Commission</th>
                <th className="num-col">Balance</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const sale = saleById.get(e.sourceId);
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td>
                      {sale ? (
                        <Link
                          href={`/vouchers/sales/${sale.id}`}
                          className="text-accent underline underline-offset-2"
                        >
                          Market sale {sale.billNo} · {sale.party.name}
                        </Link>
                      ) : (
                        "Market sale"
                      )}
                    </td>
                    <td className="num-col num text-credit">
                      {fmtMoney(e.amount)}
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
          basePath="/ledgers/commission"
          window={listWindow}
          total={total}
        />
      )}
    </Shell>
  );
}

function Shell({
  company,
  centre,
  window: listWindow,
  children,
}: {
  company: string;
  centre: string;
  window: ReturnType<typeof parseListWindow>;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-3xl">
      <Link
        href="/ledgers"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Ledgers
      </Link>
      <h1 className="heading text-xl font-semibold mt-1">Commission Ledger</h1>
      <p className="text-muted text-[13px] mb-4">
        {company} · {centre} · 2% of the Total Bill on every Market sale.
      </p>
      <DateWindow basePath="/ledgers/commission" window={listWindow} />
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: Prisma.Decimal }) {
  return (
    <div className="border border-line bg-surface px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
        {label}
      </div>
      <div className="num text-[15px] font-bold mt-0.5 text-credit">
        {fmtMoney(value)}
      </div>
    </div>
  );
}
