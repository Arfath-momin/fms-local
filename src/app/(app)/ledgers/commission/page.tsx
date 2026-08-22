import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import {
  COMMISSION_PARTY_NAME,
  RESERVE_PARTY_NAME,
} from "@/lib/settlement";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import { DateWindow, Pager } from "../../list-controls";
import { NoCentreNotice } from "../../no-centre";

const ZERO = new Prisma.Decimal(0);

/**
 * The two amounts withheld from a Market sale: the house's commission, and the
 * seller's reserve.
 *
 * Shown on one screen because they are withheld from the same bill and a
 * merchant asking "what came off this sale" wants both answers at once — but
 * totalled SEPARATELY, and never added together. Commission is income the house
 * earned; reserve is the seller's own money being held. A combined figure would
 * mean nothing, and would read as the house having earned money it must
 * eventually hand back.
 *
 * Neither is deducted from the net bill. The seller still owes the net for the
 * fish; these sit against their own accounts.
 *
 * Both are ordinary party statements pointed at standing house accounts, which
 * is why there is no bespoke table: the entries are posted by the sale action
 * through the same ledger machinery as everything else, so running balances,
 * the date window and recompute-on-edit all come for free and cannot drift
 * from the rest of the system.
 */
export default async function CommissionLedgerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const [party, reserveParty] = await Promise.all([
    prisma.party.findUnique({
      where: { name_type: { name: COMMISSION_PARTY_NAME, type: "COMMISSION" } },
      select: { id: true },
    }),
    prisma.party.findUnique({
      where: { name_type: { name: RESERVE_PARTY_NAME, type: "RESERVE" } },
      select: { id: true },
    }),
  ]);

  const listWindow = parseListWindow(await searchParams);

  // Neither account exists until something has been posted to it.
  if (!party && !reserveParty) {
    return (
      <Shell company={company.name} centre={centre.name} window={listWindow}>
        <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3 max-w-lg">
          Nothing withheld yet. Commission and reserve are recorded on a Market
          sale — commission at whatever rate that bill is struck at, reserve at
          whatever is held back — and each posts to its own account here.
        </p>
      </Shell>
    );
  }

  // One query over both accounts rather than two lists to reconcile: the rows
  // interleave by date, which is how the merchant reads them — "what came off
  // the sales this week" — and each row still says which account it belongs to.
  const partyIds = [party?.id, reserveParty?.id].filter(
    (v): v is string => !!v
  );
  const scope = {
    companyId: company.id,
    centreId: centre.id,
    partyId: { in: partyIds },
  };
  const where = { ...scope, ...dateWhere(listWindow) };

  const [entries, total, commissionTotal, reserveTotal, saleIds] =
    await Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        orderBy: [{ date: "asc" }, { seq: "asc" }],
        skip: listWindow.skip,
        take: listWindow.take,
      }),
      prisma.ledgerEntry.count({ where }),
      // Totalled per account, never summed across the two — see the note on
      // the component above.
      party
        ? prisma.ledgerEntry.aggregate({
            where: {
              companyId: company.id,
              centreId: centre.id,
              partyId: party.id,
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      reserveParty
        ? prisma.ledgerEntry.aggregate({
            where: {
              companyId: company.id,
              centreId: centre.id,
              partyId: reserveParty.id,
            },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
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

  const isReserve = (partyId: string) => partyId === reserveParty?.id;
  const windowCommission = entries
    .filter((e) => !isReserve(e.partyId))
    .reduce((a, e) => a.add(e.amount), ZERO);
  const windowReserve = entries
    .filter((e) => isReserve(e.partyId))
    .reduce((a, e) => a.add(e.amount), ZERO);

  return (
    <Shell company={company.name} centre={centre.name} window={listWindow}>
      {/* Four tiles, two per account, and deliberately no combined total: see
          the note on the component above. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat
          label="Commission earned (all time)"
          value={commissionTotal._sum.amount ?? ZERO}
        />
        <Stat label="Commission this window" value={windowCommission} />
        <Stat
          label="Reserve held (all time)"
          value={reserveTotal._sum.amount ?? ZERO}
        />
        <Stat label="Reserve this window" value={windowReserve} />
      </div>

      {entries.length === 0 ? (
        <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3 max-w-lg">
          Nothing withheld between {listWindow.from} and {listWindow.to}.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Account</th>
                <th>Transaction</th>
                <th className="num-col">Amount</th>
                <th className="num-col">Balance</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const sale = saleById.get(e.sourceId);
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td className="whitespace-nowrap">
                      {isReserve(e.partyId) ? "Reserve" : "Commission"}
                    </td>
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
                    {/* Each account keeps its own chain, so this figure is the
                        balance of the account named on THIS row — not a running
                        total down the column. The Account cell is what makes
                        that readable. */}
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
      <h1 className="heading text-xl font-semibold mt-1">
        Commission &amp; Reserve
      </h1>
      <p className="text-muted text-[13px] mb-4">
        {company} · {centre} · withheld from Market sales. Commission is the
        house&rsquo;s income; reserve is the seller&rsquo;s money held back.
        Neither is deducted from the net bill.
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
