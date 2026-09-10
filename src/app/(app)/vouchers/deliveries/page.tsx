import Link from "next/link";
import { VoucherRowActions } from "../row-actions";
import { prisma } from "@/lib/db";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { sumDeliveryLines } from "@/lib/delivery";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow,
  parsePartyFilter, type SearchParams } from "@/lib/paging";
import { DateWindow, PartyFilter, Pager } from "../../list-controls";
import { NoCentreNotice } from "../../no-centre";

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const mayEnter = canEnter(session.role);
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const listWindow = parseListWindow(await searchParams);
  const partyId = parsePartyFilter(await searchParams);
  const where = {
    companyId: company.id,
    centreId: centre.id,
    ...dateWhere(listWindow),
    // A note has no party of its own — it is a truck and a load. What it has
    // is the BILLS raised off it, so "show me UMP Ullal's trips" means the
    // trips whose bills went to them.
    ...(partyId ? { sales: { some: { partyId } } } : {}),
  };

  // Offered by kind rather than by who happens to appear in this window: a
  // merchant narrowing to a seller usually wants to find out they have no
  // entries this month, and a list that hid them could not answer that.
  const parties = await prisma.party.findMany({
    where: { type: { in: ["MARKET_BUYER", "FACTORY", "FISH_MILL", "LOCAL_BUYER"] }, archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const [notes, total, filteredLines] = await Promise.all([
    prisma.deliveryNote.findMany({
      where,
      include: { lines: true, vehicle: { select: { number: true, transporter: { select: { name: true } } } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: listWindow.skip,
      take: listWindow.take,
    }),
    prisma.deliveryNote.count({ where }),
    // Every line the filters match, not just the page on screen. A merchant
    // asking "how many boxes went to this party on that day" wants the answer
    // for what they filtered to — a total that only added up the visible page
    // would change when they turned to the next one, which is worse than no
    // total at all.
    prisma.deliveryNoteLine.findMany({
      where: { deliveryNote: where },
      select: { pack: true, box: true, kg: true, pcs: true },
    }),
  ]);
  const filteredTotals = sumDeliveryLines(filteredLines);

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Delivery Notes</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {centre.name} · dispatch records only — no
            settlement or ledger.
          </p>
        </div>
        {mayEnter && (
          <Link
            href="/vouchers/deliveries/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New Delivery Note
          </Link>
        )}
      </div>

      <DateWindow keep={{ party: partyId }} basePath="/vouchers/deliveries" window={listWindow} />
      <PartyFilter
        basePath="/vouchers/deliveries"
        window={listWindow}
        parties={parties}
        selected={partyId}
        // "Delivered to" was a lie by one word: a note names a recipient as
        // free text — a place, often — while this matches the BILLS raised
        // off the note. DN-00016 went to Suraksha and was billed to Shree
        // Matha, so filtering on Suraksha did not return it and the label
        // was the reason that looked wrong.
        label="Billed to"
      />

      {notes.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No delivery notes for {company.name} · {centre.name} between{" "}
          {listWindow.from} and {listWindow.to}. Widen the dates above to look
          further back.
          {mayEnter && " Or use “New Delivery Note” to record a dispatch."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill No.</th>
                <th>To</th>
                <th>Vehicle</th>
                <th className="num-col">Box</th>
                <th className="num-col">Total Kg</th>
                <th className="num-col">Pcs</th>
                <th className="num-col">Advance</th>
                <th className="num-col">Rent</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => {
                const t = sumDeliveryLines(n.lines);
                return (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap">{fmtDate(n.date)}</td>
                    <td className="num">{n.billNo}</td>
                    <td className="font-medium">{n.recipient}</td>
                    <td className="num">{n.vehicle.number}</td>
                    <td className="num-col num">{t.box || "—"}</td>
                    <td className="num-col num">
                      {t.totalKg.isZero() ? "—" : t.totalKg.toString()}
                    </td>
                    {/* Pcs. Its heading was here and its cell was not, so every
                        column after it sat one to the left of its own name: the
                        advance printed under Pcs, the rent under Advance, and
                        the View/PDF links under Rent. A table with more
                        headings than cells does not look broken — it looks like
                        the wrong figures. */}
                    <td className="num-col num">{t.pcs || "—"}</td>
                    {/* The advance handed to the driver at departure, and the
                        trip's total rent once a bill has reported it. Without
                        these on the list, an advance could only be found by
                        opening each note in turn. */}
                    <td className="num-col num">
                      {n.advancePaid ? fmtMoney(n.advancePaid) : "—"}
                    </td>
                    <td className="num-col num">
                      {n.rentAmount ? (
                        fmtMoney(n.rentAmount)
                      ) : (
                        <span className="text-muted text-[12px]">pending</span>
                      )}
                    </td>
                    <td>
                      <VoucherRowActions
                        viewHref={`/vouchers/deliveries/${n.id}`}
                        printHref={`/api/vouchers/deliveries/${n.id}/pdf`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* What the filters add up to, in the columns the rows use.
                One cell per column, in the header's order, rather than colSpan
                arithmetic — the columns on this table moved once before and
                the figures silently landed under the wrong headings. */}
            <tfoot>
              <tr className="border-t border-line-strong font-semibold">
                <td className="whitespace-nowrap">Total</td>
                <td></td>
                <td className="text-muted text-[12px]">
                  {total} note{total === 1 ? "" : "s"}
                  {total > notes.length ? " (all pages)" : ""}
                </td>
                <td></td>
                <td className="num-col num">{filteredTotals.box || "—"}</td>
                <td className="num-col num">
                  {filteredTotals.totalKg.isZero()
                    ? "—"
                    : filteredTotals.totalKg.toString()}
                </td>
                <td className="num-col num">{filteredTotals.pcs || "—"}</td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {notes.length > 0 && (
        <Pager
          basePath="/vouchers/deliveries"
          window={listWindow}
          total={total}
        />
      )}
    </div>
  );
}
