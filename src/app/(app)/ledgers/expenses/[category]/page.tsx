import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { expenseHighlight } from "@/lib/expense";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { fmtDate, fmtMoney } from "@/lib/format";
import { type SearchParams } from "@/lib/paging";
import { normaliseVehicleNumber } from "@/lib/vehicle";
import { NoCentreNotice } from "../../../no-centre";

const ZERO = new Prisma.Decimal(0);

/**
 * One expense head — what was spent under it, and whether it has been PAID.
 *
 * This used to be a flat list of vouchers with a total, which answered "what
 * did ice cost" and nothing else. Entering an expense does not pay it: it
 * credits the vendor, and settling is a Payment voucher against that vendor.
 * With no payment information on screen an entered expense read as a settled
 * one, which is the opposite of the truth.
 *
 * The outstanding figure is deliberately the VENDOR's whole balance, not this
 * category's. Settlement is party-level, never allocated to a particular bill
 * (invariant 7) — a payment to the ice plant settles the oldest thing owed,
 * not the row you happen to be looking at. Showing a per-category "outstanding"
 * would be inventing an allocation the ledger does not make.
 */
export default async function ExpenseCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  // The URL carries the category CODE, not its id — a link that survives the
  // category being renamed, and one a person can read.
  const code = (await params).category.toUpperCase();
  const category = await prisma.expenseCategory.findUnique({
    where: { companyId_code: { companyId: company.id, code } },
    select: { id: true, name: true, kind: true, code: true },
  });
  if (!category) notFound();
  const rawVehicleId = (await searchParams).vehicleId;
  const selectedVehicle =
    category.code === "RENT" && typeof rawVehicleId === "string"
      ? await prisma.vehicle.findFirst({
          where: { id: rawVehicleId, companyId: company.id },
          select: {
            id: true,
            number: true,
            transporter: { select: { id: true, name: true } },
          },
        })
      : null;

  const scope = { companyId: company.id, centreId: centre.id };
  const expenses = await prisma.expense.findMany({
    where: { ...scope, categoryId: category.id },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      party: { select: { id: true, name: true } },
      // Vehicle rent is the one head where the vendor is not enough to identify
      // the row: one transporter runs several vehicles, so "Ahmed · 20,000"
      // twice in a day is unreadable without the number that tells them apart.
      deliveryNote: {
        select: {
          id: true,
          billNo: true,
          recipient: true,
          vehicle: { select: { id: true, number: true } },
        },
      },
      vehicle: { select: { id: true, number: true } },
    },
  });
  const matchingExpenses = selectedVehicle
    ? expenses.filter((expense) => {
        const legacyNumber = (expense.details as Record<string, string> | null)
          ?.vehicleNo;
        return (
          expense.vehicle?.id === selectedVehicle.id ||
          expense.deliveryNote?.vehicle.id === selectedVehicle.id ||
          (legacyNumber &&
            normaliseVehicleNumber(legacyNumber) ===
              normaliseVehicleNumber(selectedVehicle.number))
        );
      })
    : expenses;
  const masterVehicles =
    category.code === "RENT"
      ? await prisma.vehicle.findMany({
          where: {
            companyId: company.id,
            archivedAt: null,
            ...(selectedVehicle ? { id: selectedVehicle.id } : {}),
          },
          select: {
            number: true,
            transporter: { select: { id: true, name: true } },
          },
        })
      : [];
  const filteredExpenses = matchingExpenses;

  // Only shown where it exists, so heads that have nothing to do with trips
  // (ice, canteen, salary) do not gain an empty column.
  const anyTrip = filteredExpenses.some((e) => e.deliveryNote);
  const anyVehicle =
    category.code === "RENT" ||
    filteredExpenses.some(
      (e) =>
        e.vehicle ||
        e.deliveryNote ||
        (e.details as Record<string, string> | null)?.vehicleNo
    );
  const total = filteredExpenses.reduce((acc, e) => acc.add(e.amount), ZERO);

  // Spend under this head, per vendor.
  const spentByVendor = new Map<
    string,
    { name: string; amount: Prisma.Decimal; vehicles: Set<string> }
  >();
  for (const e of filteredExpenses) {
    if (!e.party) continue;
    const vehicle =
      e.vehicle?.number ??
      e.deliveryNote?.vehicle.number ??
      (e.details as Record<string, string> | null)?.vehicleNo;
    const hit = spentByVendor.get(e.party.id);
    if (hit) {
      hit.amount = hit.amount.add(e.amount);
      if (vehicle) hit.vehicles.add(vehicle);
    } else {
      spentByVendor.set(e.party.id, {
        name: e.party.name,
        amount: e.amount,
        vehicles: new Set(vehicle ? [vehicle] : []),
      });
    }
  }
  for (const vehicle of masterVehicles) {
    const hit = spentByVendor.get(vehicle.transporter.id);
    if (hit) {
      hit.vehicles.add(vehicle.number);
    } else {
      spentByVendor.set(vehicle.transporter.id, {
        name: vehicle.transporter.name,
        amount: ZERO,
        vehicles: new Set([vehicle.number]),
      });
    }
  }

  // Each vendor's WHOLE position, from the ledger — what has been billed to
  // them, what has been paid, and what is left. One grouped query, never one
  // per vendor.
  const vendorIds = [...spentByVendor.keys()];
  const sums = vendorIds.length
    ? await prisma.ledgerEntry.groupBy({
        by: ["partyId", "type"],
        where: { ...scope, partyId: { in: vendorIds } },
        _sum: { amount: true },
      })
    : [];

  const owedTo = new Map<string, Prisma.Decimal>();
  const paidTo = new Map<string, Prisma.Decimal>();
  for (const r of sums) {
    // CREDIT is what we owe them; DEBIT is what has gone out to them.
    const bucket = r.type === "CREDIT" ? owedTo : paidTo;
    bucket.set(r.partyId, (bucket.get(r.partyId) ?? ZERO).add(r._sum.amount ?? ZERO));
  }

  const vendors = vendorIds
    .map((id) => {
      const owed = owedTo.get(id) ?? ZERO;
      const paid = paidTo.get(id) ?? ZERO;
      return {
        id,
        name: spentByVendor.get(id)!.name,
        spentHere: spentByVendor.get(id)!.amount,
        vehicles: [...spentByVendor.get(id)!.vehicles].sort(),
        billed: owed,
        paid,
        outstanding: owed.sub(paid),
      };
    })
    .sort(
      (a, b) =>
        b.outstanding.comparedTo(a.outstanding) || a.name.localeCompare(b.name)
    );

  const outstandingTotal = vendors.reduce((a, v) => a.add(v.outstanding), ZERO);
  const unvendored = filteredExpenses.filter((e) => !e.party);

  return (
    <div className="max-w-3xl">
      <div className="flex items-end justify-between mt-1 mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="heading text-xl font-semibold">
            {category.name} — {company.name}
          </h1>
          <p className="text-muted text-[13px]">
            {centre.name} ·{" "}
            {category.kind === "DIRECT"
              ? "a direct cost of the catch — reduces the buying day's gross profit"
              : "an overhead — reduces the month's net profit only"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[12px] uppercase tracking-wide text-muted font-semibold">
            Spent under this head
          </div>
          <div className="num text-xl font-bold text-debit">
            {fmtMoney(total)}
          </div>
        </div>
      </div>

      {vendors.length > 0 && (
        <>
          <h2 className="heading text-[15px] font-semibold mb-1">
            Who it is owed to, and what is still unpaid
          </h2>
          <p className="text-muted text-[12px] mb-2">
            Entering an expense does not pay it — it records what is owed.
            Paying is a{" "}
            <Link
              href="/vouchers/payments/new"
              className="text-accent underline underline-offset-2"
            >
              Payment voucher
            </Link>{" "}
            against the vendor. Billed and paid below are that vendor&rsquo;s
            WHOLE position, across every head: a payment settles the running
            balance, never one particular bill.
          </p>
          <div className="border border-line-strong bg-surface mb-6 overflow-x-auto">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Transporter</th>
                  {category.code === "RENT" && <th>Vehicles</th>}
                  <th className="num-col">Under this head</th>
                  <th className="num-col">Billed (all heads)</th>
                  <th className="num-col">Paid</th>
                  <th className="num-col">Still owed</th>
                  <th className="w-24"></th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id}>
                    <td className="font-medium">
                      <Link
                        href={`/ledgers/parties/${v.id}`}
                        className="text-accent underline underline-offset-2"
                      >
                        {v.name}
                      </Link>
                    </td>
                    {category.code === "RENT" && (
                      <td className="text-muted text-[12px]">
                        {v.vehicles.join(", ") || "—"}
                      </td>
                    )}
                    <td className="num-col num">{fmtMoney(v.spentHere)}</td>
                    <td className="num-col num">{fmtMoney(v.billed)}</td>
                    <td className="num-col num text-credit">
                      {fmtMoney(v.paid)}
                    </td>
                    <td
                      className={
                        "num-col num font-semibold " +
                        (v.outstanding.greaterThan(0) ? "text-debit" : "")
                      }
                    >
                      {v.outstanding.greaterThan(0)
                        ? fmtMoney(v.outstanding)
                        : "settled"}
                    </td>
                    <td>
                      <Link
                        href={`/ledgers/parties/${v.id}`}
                        className="text-accent underline underline-offset-2 text-[12px]"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={category.code === "RENT" ? 5 : 4} className="text-right font-semibold">
                    Still owed across these vendors
                  </td>
                  <td className="num-col num font-semibold text-debit">
                    {fmtMoney(outstandingTotal)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <h2 className="heading text-[15px] font-semibold mb-1">Entries</h2>
      {filteredExpenses.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3">
          No {category.name.toLowerCase()} expenses match this selection.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                {anyVehicle && <th>Vehicle</th>}
                {anyTrip && <th>Trip</th>}
                <th>Vendor</th>
                <th>Notes</th>
                <th className="num-col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                  {anyVehicle && (
                    <td className="whitespace-nowrap font-medium">
                      {e.vehicle?.number ??
                        e.deliveryNote?.vehicle.number ??
                        ((e.details as Record<string, string> | null)?.vehicleNo ??
                          "—")}
                    </td>
                  )}
                  {anyTrip && (
                    <td className="whitespace-nowrap">
                      {e.deliveryNote ? (
                        <Link
                          href={`/vouchers/deliveries/${e.deliveryNote.id}`}
                          className="text-accent underline underline-offset-2"
                        >
                          {[
                            e.deliveryNote.billNo,
                            e.deliveryNote.recipient
                              ? `To: ${e.deliveryNote.recipient}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  <td>
                    {e.party ? (
                      e.party.name
                    ) : (
                      <span className="text-muted text-[12px]">
                        no vendor — nothing owed
                      </span>
                    )}
                  </td>
                  {/* The one figure that explains this head's total — the
                      blocks of ice, the boxes loaded — falling back to the note
                      for a head that has no such figure. Finding out what a
                      ₹4,000 ice bill actually bought used to mean opening the
                      voucher. */}
                  <td className="text-muted">
                    {expenseHighlight(
                      category.code,
                      e.details as Record<string, string> | null
                    ) ??
                      e.notes ??
                      "—"}
                  </td>
                  <td className="num-col num text-debit">
                    {fmtMoney(e.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unvendored.length > 0 && (
        <p className="text-muted text-[12px] mt-2">
          {unvendored.length} entr
          {unvendored.length === 1 ? "y has" : "ies have"} no vendor — a canteen
          bill or a salary is paid as it is incurred, so there is nobody to owe
          and nothing to settle. They still count in profit.
        </p>
      )}
    </div>
  );
}
