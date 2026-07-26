import Link from "next/link";
import { prisma } from "@/lib/db";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { getFlagsFor } from "@/lib/errorflag";
import { fmtDate, fmtMoney } from "@/lib/format";
import { CorrectedBadge } from "../../lock-mark";
import { NoCentreNotice } from "../../no-centre";

const TYPE_LABELS = {
  SOCIETY: "Society",
  KFDC: "KFDC",
  PRIVATE: "Private",
  LOCAL: "Local",
};

export default async function PurchasesPage() {
  const session = await requireSession();
  const mayEnter = canEnter(session.role);
  const mayEdit = canEdit(session.role);
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const [purchases] = await Promise.all([
    prisma.purchase.findMany({
      where: { companyId: company.id, centreId: centre.id },
      include: {
        party: { select: { name: true } },
        _count: { select: { lines: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
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
            {company.name} · each purchase posts to the boat/seller ledger.
          </p>
        </div>
        {mayEnter && (
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
          {mayEnter && " Use “New Purchase” to enter the first one."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Boat / Seller</th>
                <th>Type</th>
                <th className="num-col">Total</th>
                <th>Paid</th>
                <th className="w-16"></th>
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
                    </td>
                    <td className="font-medium">
                      <span className={struck}>{p.party.name}</span>
                      {p.type === "LOCAL" && p._count.lines > 0 && (
                        <span className="text-muted text-[12px]">
                          {" "}
                          · {p._count.lines} item{p._count.lines > 1 ? "s" : ""}
                        </span>
                      )}
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
                    <td className={`num-col num text-debit ${struck}`}>
                      {fmtMoney(p.amount)}
                    </td>
                    <td className={struck}>
                      {p.paid ? (
                        <span className="text-muted text-[12px]">Paid</span>
                      ) : (
                        <span className="text-debit text-[12px] font-semibold">
                          Outstanding
                        </span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/vouchers/purchases/${p.id}`}
                        className="text-accent underline underline-offset-2 text-[12px]"
                      >
                        {mayEdit && !flag ? "Edit" : "View"}
                      </Link>
                    </td>
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
