import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";

const TYPE_LABELS = { SOCIETY: "Society", PRIVATE: "Private", LOCAL: "Local" };

export default async function PurchasesPage() {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const company = await getActiveCompany();

  const purchases = await prisma.purchase.findMany({
    where: { companyId: company.id },
    include: { party: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

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
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">{fmtDate(p.date)}</td>
                  <td className="num">{p.invoiceNumber}</td>
                  <td className="font-medium">{p.party.name}</td>
                  <td>{TYPE_LABELS[p.type]}</td>
                  <td>{p.fishType}</td>
                  <td className="num-col num">{fmtKg(p.qtyKg)}</td>
                  <td className="num-col num text-debit">
                    {fmtMoney(p.amount)}
                  </td>
                  {isMerchant && (
                    <td>
                      <Link
                        href={`/vouchers/purchases/${p.id}`}
                        className="text-accent underline underline-offset-2 text-[12px]"
                      >
                        Edit
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
