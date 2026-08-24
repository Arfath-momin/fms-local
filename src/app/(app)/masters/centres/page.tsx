import { prisma } from "@/lib/db";
import { canAdminister, canSuperAdminister, requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getActiveCentre } from "@/lib/centre";
import { fmtDate } from "@/lib/format";
import { CentreCreateForm } from "./centre-create-form";
import { CentreActionsCell } from "./centre-actions-cell";

export default async function CentresPage() {
  const session = await requireSession();
  const mayManage = canAdminister(session.role);
  const isSuperAdmin = canSuperAdminister(session.role);
  const company = await getActiveCompany();
  // Archived centres are listed here, unlike in the switcher — this is the one
  // screen where you need to see what was retired in order to manage it.
  const [centres, activeCentre] = await Promise.all([
    prisma.centre.findMany({
      where: { companyId: company.id },
      // Live centres first: Postgres sorts NULLs last on ASC by default, and
      // archived_at is NULL for exactly the rows that belong at the top.
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
      include: {
        _count: {
          select: {
            purchases: true,
            sales: true,
            deliveryNotes: true,
            expenses: true,
            ledgerEntries: true,
            settlements: true,
            attachments: true,
            reviewRequests: true,
          },
        },
      },
    }),
    getActiveCentre(company.id),
  ]);

  const liveCount = centres.filter((c) => c.archivedAt === null).length;

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
        <div className="border border-line-strong bg-surface mb-4 overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Centre</th>
                <th className="num-col">Purchases</th>
                <th className="num-col">Expenses</th>
                <th className="num-col">Deliveries</th>
                <th>Added</th>
                {mayManage && <th className="w-44"></th>}
              </tr>
            </thead>
            <tbody>
              {centres.map((c) => {
                const archived = c.archivedAt !== null;
                const references = Object.values(c._count).reduce(
                  (a, b) => a + b,
                  0
                );
                return (
                  <tr key={c.id} className={archived ? "opacity-60" : ""}>
                    <td className="font-medium">
                      {c.name}
                      {c.id === activeCentre?.id && !archived && (
                        <span className="ml-2 text-[11px] font-semibold text-accent uppercase tracking-wide">
                          active
                        </span>
                      )}
                      {archived && (
                        <span className="ml-2 text-[11px] font-semibold text-muted uppercase tracking-wide">
                          archived
                        </span>
                      )}
                    </td>
                    <td className="num-col num">{c._count.purchases}</td>
                    <td className="num-col num">{c._count.expenses}</td>
                    <td className="num-col num">{c._count.deliveryNotes}</td>
                    <td className="text-muted whitespace-nowrap">
                      {fmtDate(c.createdAt)}
                    </td>
                    {mayManage && (
                      <td className="align-top">
                        <CentreActionsCell
                          centreId={c.id}
                          name={c.name}
                          archived={archived}
                          references={references}
                          isSuperAdmin={isSuperAdmin}
                          isLastLive={!archived && liveCount === 1}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {mayManage && <CentreCreateForm />}
    </div>
  );
}
