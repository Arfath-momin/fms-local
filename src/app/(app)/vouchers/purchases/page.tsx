import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getClosedDateSet } from "@/lib/dayclose";
import { getFlagsFor } from "@/lib/errorflag";
import { fmtDate, fmtKg, fmtMoney, toInputDate } from "@/lib/format";
import { CorrectedBadge, LockMark } from "../../lock-mark";

const TYPE_LABELS = { SOCIETY: "Society", PRIVATE: "Private", LOCAL: "Local" };

export default async function PurchasesPage() {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const company = await getActiveCompany();

  const [purchases, closedDates] = await Promise.all([
    prisma.purchase.findMany({
      where: { companyId: company.id },
      include: { party: { select: { name: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    getClosedDateSet(company.id),
  ]);
  const flags = await getFlagsFor(
    "PURCHASE",
    purchases.map((p) => p.id)
  );

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Purchases</h1>
          <p className="text-muted text-[13px]">
            {company.name} · every purchase adds stock and posts to the
            seller&apos;s ledger.
          </p>
        </div>
        {isMerchant && (
          <Link
            href="/vouchers/purchases/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New Purchase
          </Link>
        )}
      </div>

      {purchases.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No purchases for {company.name} yet.
          {isMerchant && " Use “New Purchase” to enter the first one."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice</th>
                <th>Party</th>
                <th>Type</th>
                <th>Fish</th>
                <th className="num-col">Qty</th>
                <th className="num-col">Amount</th>
                {isMerchant && <th className="w-16"></th>}
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const flag = flags.get(p.id);
                const struck = flag ? "line-through opacity-60" : "";
                return (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      {fmtDate(p.date)}
                      <LockMark closed={closedDates.has(toInputDate(p.date))} />
                    </td>
                    <td className={`num ${struck}`}>{p.invoiceNumber}</td>
                    <td className="font-medium">
                      <span className={struck}>{p.party.name}</span>
                      {flag && (
                        <CorrectedBadge
                          href={
                            flag.correctingEntryId
                              ? `/vouchers/purchases/${flag.correctingEntryId}`
                              : null
                          }
                        />
                      )}
                    </td>
                    <td className={struck}>{TYPE_LABELS[p.type]}</td>
                    <td className={struck}>{p.fishType}</td>
                    <td className={`num-col num ${struck}`}>{fmtKg(p.qtyKg)}</td>
                    <td className={`num-col num text-debit ${struck}`}>
                      {fmtMoney(p.amount)}
                    </td>
                    {isMerchant && (
                      <td>
                        <Link
                          href={`/vouchers/purchases/${p.id}`}
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
