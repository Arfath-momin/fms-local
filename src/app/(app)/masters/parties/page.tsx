import Link from "next/link";
import type { PartyType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  canAdminister,
  canEnter,
  canSuperAdminister,
  requireSession,
} from "@/lib/session";
import {
  PARTY_TYPES,
  PARTY_TYPE_LABELS,
  PARTY_TYPE_PLURALS,
} from "@/lib/party";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { PartyActionsCell } from "./party-actions-cell";

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; archived?: string }>;
}) {
  const session = await requireSession();
  const mayManage = canEnter(session.role);
  const mayRetire = canAdminister(session.role);
  const isSuperAdmin = canSuperAdminister(session.role);

  const params = await searchParams;
  const rawType = params.type as PartyType | undefined;
  const type = rawType && PARTY_TYPES.includes(rawType) ? rawType : null;
  const showArchived = params.archived === "1";

  const [parties, archivedCount] = await Promise.all([
    prisma.party.findMany({
      where: {
        ...(type ? { type } : {}),
        // The archived view is a separate list rather than a mixed one with the
        // retired rows greyed out — mixing them puts names back in front of the
        // person who just removed them, which is what they asked to stop.
        archivedAt: showArchived ? { not: null } : null,
      },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: {
            purchases: true,
            purchaseLinesAsBoat: true,
            expenses: true,
            ledgerEntries: true,
            salesAsBuyer: true,
            salesAsCareOf: true,
            settlements: true,
            vehicles: true,
            reserveCollections: true,
          },
        },
      },
    }),
    prisma.party.count({
      where: { ...(type ? { type } : {}), archivedAt: { not: null } },
    }),
  ]);

  const base = type ? PARTY_TYPE_PLURALS[type] : "All Parties";
  const title = showArchived ? `${base} · Archived` : base;
  const newHref = type
    ? `/masters/parties/new?type=${type}`
    : "/masters/parties/new";
  const activeHref = `/masters/parties${type ? `?type=${type}` : ""}`;
  const archivedHref = `/masters/parties?${type ? `type=${type}&` : ""}archived=1`;

  return (
    <div>
      <Link
        href="/masters"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Masters
      </Link>
      <div className="flex items-end justify-between mt-1 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">{title}</h1>
          <p className="text-muted text-[13px]">
            {showArchived
              ? "Removed from the pickers. Every voucher and ledger entry they appear on is unchanged."
              : "Shared master across BFM and B2B. Balances are per company, on each party's ledger."}
          </p>
        </div>
        {mayManage && !showArchived && (
          <Link
            href={newHref}
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New {type ? PARTY_TYPE_LABELS[type] : "Party"}
          </Link>
        )}
      </div>

      {/* Only offered once something is actually archived, so the ordinary
          master list is not cluttered by a view that would always be empty. */}
      {(showArchived || archivedCount > 0) && (
        <p className="text-[12px] mb-3">
          <Link
            href={showArchived ? activeHref : archivedHref}
            className="text-accent underline underline-offset-2"
          >
            {showArchived
              ? "← Back to the active list"
              : `Show ${archivedCount} archived`}
          </Link>
        </p>
      )}

      {parties.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          {showArchived ? (
            `Nothing archived here.`
          ) : (
            <>
              No {type ? PARTY_TYPE_LABELS[type].toLowerCase() : "party"} entries
              yet.
              {mayManage &&
                ` Use “New ${type ? PARTY_TYPE_LABELS[type] : "Party"}” to add the first one.`}
            </>
          )}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface max-w-3xl">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Name</th>
                {!type && <th>Type</th>}
                <th>Contact</th>
                <th className="num-col">Used on</th>
                {mayManage && <th className="w-16"></th>}
                {mayRetire && <th className="w-44"></th>}
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => {
                const references = Object.values(p._count).reduce(
                  (a, b) => a + b,
                  0
                );
                return (
                  <tr key={p.id}>
                    <td className="font-medium">
                      {p.name}
                      {/* Which purchase kind files this seller — the reason a
                          Private bill suggests them and a Local one does not. */}
                      {p.purchaseKind && (
                        <span className="ml-2 text-[11px] uppercase tracking-wide text-muted">
                          {PURCHASE_TYPE_LABELS[p.purchaseKind]}
                        </span>
                      )}
                    </td>
                    {!type && <td>{PARTY_TYPE_LABELS[p.type]}</td>}
                    <td className="text-muted">{p.contactInfo ?? "—"}</td>
                    {/* Says plainly what archiving will and will not touch, and
                        is what decides whether a real delete is even offered. */}
                    <td className="num-col num text-muted">
                      {references === 0 ? "never used" : references}
                    </td>
                    {mayManage && (
                      <td>
                        <Link
                          href={`/masters/parties/${p.id}`}
                          className="text-accent underline underline-offset-2 text-[12px]"
                        >
                          Edit
                        </Link>
                      </td>
                    )}
                    {mayRetire && (
                      <td className="align-top">
                        <PartyActionsCell
                          partyId={p.id}
                          name={p.name}
                          archived={p.archivedAt !== null}
                          references={references}
                          isSuperAdmin={isSuperAdmin}
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
    </div>
  );
}
