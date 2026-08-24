import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { canEnter, canEdit, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { reserveBalances } from "@/lib/reserve";
import { SETTLEMENT_MODE_LABELS } from "@/lib/settlement";
import { fmtDate, fmtMoney } from "@/lib/format";
import { NoCentreNotice } from "../../no-centre";
import { DeleteCollection } from "./delete-collection";

const ZERO = new Prisma.Decimal(0);

/**
 * Who holds how much reserve.
 *
 * The replacement for the old pooled "Reserve" account, and the difference is
 * the entire point. A single ₹6,000 balance could not tell you who to ask for
 * it; this is a list of names against figures, which is the question a merchant
 * actually has when it comes time to collect.
 *
 * Nothing here is stored. Each figure is SUM(sales.reserve) − SUM(collections)
 * for that party, so it cannot drift from the bills it came off.
 */
export default async function ReserveLedgerPage() {
  const session = await requireSession();
  const mayEnter = canEnter(session.role);
  const mayEdit = canEdit(session.role);
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const scope = { companyId: company.id, centreId: centre.id };
  const [balances, collections] = await Promise.all([
    reserveBalances(scope),
    prisma.reserveCollection.findMany({
      where: scope,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        amount: true,
        date: true,
        mode: true,
        reference: true,
        party: { select: { name: true } },
      },
    }),
  ]);

  const outstanding = balances.reduce((a, b) => a.add(b.outstanding), ZERO);
  const withheld = balances.reduce((a, b) => a.add(b.withheld), ZERO);
  const collected = balances.reduce((a, b) => a.add(b.collected), ZERO);

  return (
    <div className="max-w-3xl">
      <Link
        href="/ledgers"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Ledgers
      </Link>
      <div className="flex items-end justify-between mt-1 mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="heading text-xl font-semibold">Reserve</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {centre.name} · money market parties withheld and
            pay back later. Tracked per party, never pooled.
          </p>
        </div>
        {mayEnter && (
          <Link
            href="/vouchers/reserve-collections/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            Collect reserve
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Stat label="Withheld (all time)" value={withheld} />
        <Stat label="Collected" value={collected} />
        <Stat label="Still held by parties" value={outstanding} strong />
      </div>

      {balances.length === 0 ? (
        <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3">
          No reserve has been withheld yet. It is entered on a Market sale, as
          one of the deductions the market makes on the bill.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface mb-6 overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Market party</th>
                <th className="num-col">Withheld</th>
                <th className="num-col">Collected</th>
                <th className="num-col">Still holds</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.partyId}>
                  <td className="font-medium">
                    <Link
                      href={`/ledgers/parties/${b.partyId}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {b.partyName}
                    </Link>
                  </td>
                  <td className="num-col num">{fmtMoney(b.withheld)}</td>
                  <td className="num-col num">{fmtMoney(b.collected)}</td>
                  <td
                    className={
                      "num-col num font-semibold " +
                      // Negative means more was collected than was ever
                      // withheld — a real error worth showing, not hiding.
                      (b.outstanding.lessThan(0) ? "text-debit" : "")
                    }
                  >
                    {fmtMoney(b.outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {collections.length > 0 && (
        <>
          <h2 className="heading text-[15px] font-semibold mb-1">
            Recent collections
          </h2>
          <p className="text-muted text-[12px] mb-2">
            Recognised as income on the day the money arrived — which is the one
            date in the system that is not a buying day.
          </p>
          <div className="border border-line-strong bg-surface overflow-x-auto">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Party</th>
                  <th>How</th>
                  <th className="num-col">Amount</th>
                  {mayEdit && <th className="w-20"></th>}
                </tr>
              </thead>
              <tbody>
                {collections.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">{fmtDate(c.date)}</td>
                    <td>{c.party.name}</td>
                    <td className="text-muted text-[12px]">
                      {SETTLEMENT_MODE_LABELS[c.mode]}
                      {c.reference ? ` · ${c.reference}` : ""}
                    </td>
                    <td className="num-col num text-credit">
                      {fmtMoney(c.amount)}
                    </td>
                    {mayEdit && (
                      <td>
                        <DeleteCollection
                          collectionId={c.id}
                          party={c.party.name}
                          amount={fmtMoney(c.amount)}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: Prisma.Decimal;
  strong?: boolean;
}) {
  return (
    <div className="border border-line bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
        {label}
      </div>
      <div
        className={"num " + (strong ? "text-lg font-bold" : "text-[15px]")}
      >
        {fmtMoney(value)}
      </div>
    </div>
  );
}
