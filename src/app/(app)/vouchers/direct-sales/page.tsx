import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";

export default async function DirectSalesPage() {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const company = await getActiveCompany();

  const sales = await prisma.directSale.findMany({
    where: { companyId: company.id },
    include: { party: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

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
              {sales.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap">{fmtDate(s.date)}</td>
                  <td className="font-medium">{s.party.name}</td>
                  <td>{s.fishType}</td>
                  <td className="num-col num">{fmtKg(s.qtyKg)}</td>
                  <td className="num-col num">{fmtMoney(s.rate)}</td>
                  <td className="num-col num text-credit">
                    {fmtMoney(s.amount)}
                  </td>
                  {isMerchant && (
                    <td>
                      <Link
                        href={`/vouchers/direct-sales/${s.id}`}
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
