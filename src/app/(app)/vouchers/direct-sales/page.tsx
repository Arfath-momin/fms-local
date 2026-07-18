import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getClosedDateSet } from "@/lib/dayclose";
import { getFlagsFor } from "@/lib/errorflag";
import { fmtDate, fmtKg, fmtMoney, toInputDate } from "@/lib/format";
import { CorrectedBadge, LockMark } from "../../lock-mark";

export default async function DirectSalesPage() {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const company = await getActiveCompany();

  const [sales, closedDates] = await Promise.all([
    prisma.directSale.findMany({
      where: { companyId: company.id },
      include: { party: { select: { name: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    getClosedDateSet(company.id),
  ]);
  const flags = await getFlagsFor(
    "DIRECT_SALE",
    sales.map((s) => s.id)
  );

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Direct Sales</h1>
          <p className="text-muted text-[13px]">
            {company.name} · quick local sales — stock sold and paid in one
            step, no delivery note.
          </p>
        </div>
        {isMerchant && (
          <Link
            href="/vouchers/direct-sales/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New Direct Sale
          </Link>
        )}
      </div>

      {sales.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No direct sales for {company.name} yet.
          {isMerchant && " Use “New Direct Sale” for a quick local sale."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Buyer</th>
                <th>Fish</th>
                <th className="num-col">Qty</th>
                <th className="num-col">Rate</th>
                <th className="num-col">Amount</th>
                {isMerchant && <th className="w-16"></th>}
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const flag = flags.get(s.id);
                const struck = flag ? "line-through opacity-60" : "";
                return (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">
                      {fmtDate(s.date)}
                      <LockMark closed={closedDates.has(toInputDate(s.date))} />
                    </td>
                    <td className="font-medium">
                      <span className={struck}>{s.party.name}</span>
                      {flag && (
                        <CorrectedBadge
                          href={
                            flag.correctingEntryId
                              ? `/vouchers/direct-sales/${flag.correctingEntryId}`
                              : null
                          }
                        />
                      )}
                    </td>
                    <td className={struck}>{s.fishType}</td>
                    <td className={`num-col num ${struck}`}>{fmtKg(s.qtyKg)}</td>
                    <td className={`num-col num ${struck}`}>{fmtMoney(s.rate)}</td>
                    <td className={`num-col num text-credit ${struck}`}>
                      {fmtMoney(s.amount)}
                    </td>
                    {isMerchant && (
                      <td>
                        <Link
                          href={`/vouchers/direct-sales/${s.id}`}
                          className="text-accent underline underline-offset-2 text-[12px]"
                        >
                          {flag ? "View" : "Edit"}
                        </Link>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
