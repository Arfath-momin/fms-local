import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getActiveCentre } from "@/lib/centre";
import { fmtDate } from "@/lib/format";
import { CentreCreateForm } from "./centre-create-form";

export default async function CentresPage() {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const company = await getActiveCompany();
  const [centres, activeCentre] = await Promise.all([
    prisma.centre.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { purchases: true, expenses: true, deliveryNotes: true },
        },
      },
    }),
    getActiveCentre(company.id),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="heading text-xl font-semibold mb-1">Centres</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · each centre keeps its own isolated transactions and
        ledgers. Switch the active centre from the sidebar.
      </p>

      {centres.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 mb-4">
          {company.name} has no centre yet. Add the first one below.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface mb-4">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Centre</th>
                <th className="num-col">Purchases</th>
                <th className="num-col">Expenses</th>
                <th className="num-col">Deliveries</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {centres.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">
                    {c.name}
                    {c.id === activeCentre?.id && (
                      <span className="ml-2 text-[11px] font-semibold text-accent uppercase tracking-wide">
                        active
                      </span>
                    )}
                  </td>
                  <td className="num-col num">{c._count.purchases}</td>
                  <td className="num-col num">{c._count.expenses}</td>
                  <td className="num-col num">{c._count.deliveryNotes}</td>
                  <td className="text-muted whitespace-nowrap">
                    {fmtDate(c.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isMerchant && <CentreCreateForm />}
    </div>
  );
}
