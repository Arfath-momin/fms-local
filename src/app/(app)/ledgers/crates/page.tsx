import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession, canEnter, canEdit } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { crateBalances, crateStatement, type CrateRow } from "@/lib/crate";
import { fmtDate } from "@/lib/format";
import { NoCentreNotice } from "../../no-centre";
import { BoxTabs } from "../boxes/tabs";
import { DeleteCrateEntry } from "./delete-entry";

/**
 * What each market is still holding, in empty crates.
 *
 * The merchant's own statement, column for column: who, where, which trip, what
 * they already held, what went out, what came back, and what they hold now —
 * with the vehicle and the line man read off the trip, so the row says who
 * carried the crates and who unloaded them.
 *
 * Every balance is DERIVED from the rows in order. Nothing is stored, so a
 * corrected row cannot leave a stale total behind it, and there is no repair
 * path to get wrong.
 */
export default async function CrateLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ party?: string }>;
}) {
  const session = await requireSession();
  const mayEnter = canEnter(session.role);
  const mayEdit = canEdit(session.role);
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;
  const scope = { companyId: company.id, centreId: centre.id };

  const balances = await crateBalances(scope);
  const { party: partyId } = await searchParams;

  // One market's full account, when one is chosen. Otherwise the list of who
  // holds what, which is the question that gets asked first.
  const selected = partyId
    ? await prisma.party.findFirst({
        where: { id: partyId },
        select: { id: true, name: true },
      })
    : null;
  const rows: CrateRow[] = selected
    ? await crateStatement(scope, selected.id)
    : [];

  const totalHeld = balances.reduce((a, b) => a + b.holding, 0);

  return (
    <div className="max-w-4xl">
      <div className="flex items-end justify-between mt-1 mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="heading text-xl font-semibold">Crates held</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {centre.name} · your crates, on loan to the market
            until the empties come back.
          </p>
        </div>
        {mayEnter && (
          <Link
            href="/vouchers/crates/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            Record crates
          </Link>
        )}
      </div>

      <BoxTabs active="crates" />

      {balances.length === 0 ? (
        <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3">
          No crates recorded yet. Enter what went out with a load, or what a
          market was already holding when the books opened.
        </p>
      ) : (
        <>
          <div className="border border-line bg-surface px-4 py-3 mb-4">
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
              Out with markets
            </div>
            <div className="num text-xl font-bold">{totalHeld}</div>
          </div>

          <div className="border border-line-strong bg-surface mb-6 overflow-x-auto">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th className="num-col">Sent</th>
                  <th className="num-col">Returned</th>
                  <th className="num-col">Holding</th>
                  <th>Last movement</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.partyId}>
                    <td className="font-medium">
                      <Link
                        href={`/ledgers/crates?party=${b.partyId}`}
                        className="text-accent underline underline-offset-2"
                      >
                        {b.partyName}
                      </Link>
                    </td>
                    <td className="num-col num">{b.out}</td>
                    <td className="num-col num">{b.returned}</td>
                    <td
                      className={
                        "num-col num font-semibold " +
                        // Negative means more crates came back than ever went
                        // out — real, and usually a trip nobody entered.
                        (b.holding < 0 ? "text-debit" : "")
                      }
                    >
                      {b.holding}
                    </td>
                    <td className="text-muted text-[12px] whitespace-nowrap">
                      {b.lastMovement ? fmtDate(b.lastMovement) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected && (
        <>
          <h2 className="heading text-[15px] font-semibold mb-1">
            {selected.name}
          </h2>
          <p className="text-muted text-[12px] mb-2">
            Oldest first, with the balance carried down. The vehicle and the
            line man come from the trip each row was entered against.
          </p>
          {rows.length === 0 ? (
            <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3">
              Nothing recorded against {selected.name} yet.
            </p>
          ) : (
            <div className="border border-line-strong bg-surface overflow-x-auto">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Place</th>
                    <th>Trip</th>
                    <th className="num-col">Old bal.</th>
                    <th className="num-col">Box</th>
                    <th className="num-col">Return</th>
                    <th className="num-col">Balance</th>
                    <th>Vehicle</th>
                    <th>Line man</th>
                    {mayEdit && <th className="w-16"></th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td>{r.place ?? "—"}</td>
                      <td>
                        {r.tripId ? (
                          <Link
                            href={`/vouchers/deliveries/${r.tripId}`}
                            className="text-accent underline underline-offset-2 num"
                          >
                            {r.tripBillNo}
                          </Link>
                        ) : (
                          <span className="text-muted text-[12px]">
                            opening
                          </span>
                        )}
                      </td>
                      <td className="num-col num text-muted">
                        {r.openingBalance}
                      </td>
                      <td className="num-col num">{r.boxesOut || "—"}</td>
                      <td className="num-col num text-credit">
                        {r.boxesReturned || "—"}
                      </td>
                      <td className="num-col num font-semibold">{r.balance}</td>
                      <td className="num">{r.vehicleNumber ?? "—"}</td>
                      <td>{r.lineManName ?? "—"}</td>
                      {mayEdit && (
                        <td>
                          <DeleteCrateEntry
                            entryId={r.id}
                            party={selected.name}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
