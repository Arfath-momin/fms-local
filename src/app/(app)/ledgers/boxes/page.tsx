import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import {
  boxStatements,
  TRIP_CHANNEL_LABELS,
  TRIP_STATUS_LABELS,
} from "@/lib/trip";
import { fmtDate } from "@/lib/format";
import { parseListWindow, type SearchParams } from "@/lib/paging";
import { DateWindow } from "../../list-controls";
import { NoCentreNotice } from "../../no-centre";

/**
 * Where every box went.
 *
 * A hundred boxes leave on a truck, three markets unload them, and it has to
 * come back to nothing. The reconciliation panel on a trip answers "does it add
 * up"; this answers "where did they go" across every trip at once — the
 * question when a market claims it received less than it was billed for.
 *
 * Nothing here is stored. A drop is a sale's box lines against the trip it came
 * off, so the statement cannot drift from the bills it is built from.
 */
export default async function BoxLedgerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const listWindow = parseListWindow(await searchParams);
  const statements = await boxStatements(
    { companyId: company.id, centreId: centre.id },
    { from: listWindow.fromDate, to: listWindow.toDate }
  );

  const withBoxes = statements.filter(
    (s) => s.dispatched > 0 || s.drops.length > 0
  );
  const totalOut = withBoxes.reduce((a, s) => a + s.dispatched, 0);
  // Trips billed by weight are left out of the headline: their box column is
  // empty by nature, not by omission.
  const totalUnaccounted = withBoxes
    .filter((s) => !s.billedWithoutBoxes)
    .reduce((a, s) => a + s.unaccounted, 0);

  return (
    <div className="max-w-3xl">
      <Link
        href="/ledgers"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Ledgers
      </Link>
      <h1 className="heading text-xl font-semibold mt-1">Box Statement</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · {centre.name} · what went out on each truck, and who
        unloaded it. Every load should come back to nothing.
      </p>

      <DateWindow basePath="/ledgers/boxes" window={listWindow} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4">
        <Stat label="Trips" value={String(withBoxes.length)} />
        <Stat label="Boxes dispatched" value={String(totalOut)} />
        <Stat
          label="Unaccounted"
          value={String(totalUnaccounted)}
          tone={totalUnaccounted !== 0 ? "warn" : undefined}
        />
      </div>

      {withBoxes.length === 0 ? (
        <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3">
          No boxes went out between {listWindow.from} and {listWindow.to}.
        </p>
      ) : (
        <div className="space-y-4">
          {withBoxes.map((s) => (
            <div
              key={s.tripId}
              className="border border-line-strong bg-surface overflow-x-auto"
            >
              <div className="px-4 py-2 border-b border-line flex items-baseline justify-between gap-3 flex-wrap">
                <div>
                  <Link
                    href={`/vouchers/deliveries/${s.tripId}`}
                    className="font-semibold text-accent underline underline-offset-2 num"
                  >
                    {s.billNo}
                  </Link>
                  <span className="text-muted text-[12px]">
                    {" "}
                    · {s.vehicleNumber} · {fmtDate(s.date)} ·{" "}
                    {TRIP_CHANNEL_LABELS[s.channel]}
                  </span>
                </div>
                <span className="text-muted text-[12px]">
                  {TRIP_STATUS_LABELS[s.status]}
                </span>
              </div>

              <table className="ledger-table">
                <tbody>
                  {/* The load, then each drop taken off it, then what is left —
                      read down the column the way a merchant counts it. */}
                  <tr>
                    <td className="font-semibold">Dispatched</td>
                    <td className="text-muted text-[12px]">
                      {s.dispatchedByParticular
                        .map((p) => `${p.particular} ${p.boxes}`)
                        .join(" · ") || "—"}
                    </td>
                    <td className="num-col num font-semibold">{s.dispatched}</td>
                    <td className="num-col num text-muted">{s.dispatched}</td>
                  </tr>

                  {s.drops.map((d, i) => {
                    // The running remainder after this drop — the figure the
                    // merchant is actually tracking down the column.
                    const left =
                      s.dispatched -
                      s.drops.slice(0, i + 1).reduce((a, x) => a + x.boxes, 0);
                    return (
                      <tr key={d.saleId}>
                        <td>
                          <Link
                            href={`/vouchers/sales/${d.saleId}`}
                            className="text-accent underline underline-offset-2"
                          >
                            {d.partyName}
                          </Link>
                          <span className="text-muted text-[12px] num">
                            {" "}
                            · {d.billNo}
                          </span>
                        </td>
                        <td className="text-muted text-[12px]">
                          {d.byParticular
                            .map((p) => `${p.particular} ${p.boxes}`)
                            .join(" · ") || "—"}
                        </td>
                        <td className="num-col num text-debit">
                          {d.boxes ? `−${d.boxes}` : "—"}
                        </td>
                        <td className="num-col num text-muted">{left}</td>
                      </tr>
                    );
                  })}

                  {(() => {
                    // A factory bills the kilos it accepted and a lump-sum bill
                    // itemises nothing, so an empty box column there is the
                    // nature of the bill, not a missing load.
                    const short = !s.billedWithoutBoxes && s.unaccounted !== 0;
                    return (
                      <tr className="border-t border-line-strong">
                        <td
                          className={"font-semibold " + (short ? "text-debit" : "")}
                        >
                          {s.billedWithoutBoxes
                            ? "Billed by weight — boxes not itemised"
                            : s.unaccounted === 0
                              ? "Fully accounted for"
                              : s.unaccounted > 0
                                ? "Still unbilled"
                                : "Billed more than went out"}
                        </td>
                        <td className="text-muted text-[12px]">
                          {s.cratesReturned != null &&
                            `${s.cratesReturned} crates back`}
                        </td>
                        <td className="num-col num" />
                        <td
                          className={
                            "num-col num font-bold " + (short ? "text-debit" : "")
                          }
                        >
                          {s.billedWithoutBoxes ? "—" : s.unaccounted}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="border border-line bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
        {label}
      </div>
      <div
        className={
          "num text-lg font-bold " + (tone === "warn" ? "text-debit" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
