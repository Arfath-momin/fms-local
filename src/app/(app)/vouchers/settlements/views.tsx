import Link from "next/link";
import { notFound } from "next/navigation";
import type { SettlementKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { PARTY_TYPE_LABELS } from "@/lib/party";
import { fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import {
  SETTLEMENT_KIND_BLURBS,
  SETTLEMENT_KIND_LABELS,
  SETTLEMENT_KIND_PLURALS,
  SETTLEMENT_MODE_LABELS,
  SETTLEMENT_PATH,
} from "@/lib/settlement";
import { DateWindow, Pager } from "../../list-controls";
import { NoCentreNotice } from "../../no-centre";
import { DeleteVoucher } from "../delete-voucher";
import { ReviewPanel } from "../review-panel";
import { VoucherMeta } from "../voucher-meta";
import { deleteSettlement } from "./actions";

// Payments and Receipts are the same voucher with opposite signs, so they
// share these views rather than each carrying a near-identical copy. The kind
// is the only thing the route files supply.

export async function SettlementListPage({
  kind,
  searchParams,
}: {
  kind: SettlementKind;
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const listWindow = parseListWindow(await searchParams);
  const where = {
    companyId: company.id,
    centreId: centre.id,
    kind,
    ...dateWhere(listWindow),
  };

  const [rows, total, sum] = await Promise.all([
    prisma.settlement.findMany({
      where,
      include: { party: { select: { name: true, type: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: listWindow.skip,
      take: listWindow.take,
    }),
    prisma.settlement.count({ where }),
    prisma.settlement.aggregate({ where, _sum: { amount: true } }),
  ]);

  const base = SETTLEMENT_PATH[kind];
  const isPayment = kind === "PAYMENT";

  return (
    <div>
      <div className="flex items-end justify-between mb-3 flex-wrap gap-3">
        <div>
          <h1 className="heading text-xl font-semibold">
            {SETTLEMENT_KIND_PLURALS[kind]}
          </h1>
          <p className="text-muted text-[13px] max-w-xl">
            {company.name} · {centre.name} · {SETTLEMENT_KIND_BLURBS[kind]}
          </p>
        </div>
        {canEnter(session.role) && (
          <Link
            href={`${base}/new`}
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New {SETTLEMENT_KIND_LABELS[kind]}
          </Link>
        )}
      </div>

      <DateWindow basePath={base} window={listWindow} />

      {rows.length === 0 ? (
        <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3 max-w-lg">
          No {SETTLEMENT_KIND_PLURALS[kind].toLowerCase()} between{" "}
          {listWindow.from} and {listWindow.to}.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>{isPayment ? "Paid to" : "Received from"}</th>
                <th>Mode</th>
                <th>Reference</th>
                <th className="num-col">Amount</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="font-medium">
                    {r.party.name}
                    <span className="text-muted text-[12px]">
                      {" "}
                      · {PARTY_TYPE_LABELS[r.party.type]}
                    </span>
                  </td>
                  <td>{SETTLEMENT_MODE_LABELS[r.mode]}</td>
                  <td className="num">
                    {r.reference ?? <span className="text-muted">—</span>}
                  </td>
                  <td
                    className={`num-col num font-semibold ${
                      isPayment ? "text-debit" : "text-credit"
                    }`}
                  >
                    {fmtMoney(r.amount)}
                  </td>
                  <td>
                    <Link
                      href={`${base}/${r.id}`}
                      className="text-accent underline underline-offset-2 text-[12px]"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-line-strong font-semibold">
                <td colSpan={4}>Total shown</td>
                <td
                  className={`num-col num ${isPayment ? "text-debit" : "text-credit"}`}
                >
                  {fmtMoney(sum._sum.amount ?? 0)}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <Pager basePath={base} window={listWindow} total={total} />
      )}
    </div>
  );
}

export async function SettlementDetailPage({
  kind,
  id,
}: {
  kind: SettlementKind;
  id: string;
}) {
  const session = await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const settlement = await prisma.settlement.findFirst({
    // Scoped, not just found by id. A voucher belonging to another company or
    // centre must not open — let alone be editable — from the scope you are in.
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
      party: { select: { id: true, name: true, type: true } },
      centre: { select: { name: true } },
      company: { select: { name: true } },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!settlement || settlement.kind !== kind) notFound();

  const base = SETTLEMENT_PATH[kind];
  const isPayment = kind === "PAYMENT";

  return (
    <div className="max-w-lg">

      <div className="flex items-end justify-between flex-wrap gap-3 mt-1 mb-4 gap-3">
        <div>
          <h1 className="heading text-xl font-semibold">
            {SETTLEMENT_KIND_LABELS[kind]} · {fmtDate(settlement.date)}
          </h1>
          <p className="text-muted text-[13px]">
            {settlement.company.name} · {settlement.centre.name}
          </p>
        </div>
        {canEdit(session.role) && (
          <Link
            href={`${base}/${settlement.id}/edit`}
            className="border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold hover:border-accent"
          >
            Edit
          </Link>
        )}
      </div>

      <div className="border border-line-strong bg-surface divide-y divide-line">
        <Field
          label={isPayment ? "Paid to" : "Received from"}
          value={
            <Link
              href={`/ledgers/parties/${settlement.party.id}`}
              className="text-accent underline underline-offset-2"
            >
              {settlement.party.name}
            </Link>
          }
        />
        <Field
          label="Party type"
          value={PARTY_TYPE_LABELS[settlement.party.type]}
        />
        <Field
          label="Amount"
          value={
            <span
              className={`num font-semibold ${isPayment ? "text-debit" : "text-credit"}`}
            >
              {fmtMoney(settlement.amount)}
            </span>
          }
        />
        <Field label="Mode" value={SETTLEMENT_MODE_LABELS[settlement.mode]} />
        {settlement.reference && (
          <Field label="Reference" value={settlement.reference} />
        )}
        {settlement.notes && <Field label="Notes" value={settlement.notes} />}
      </div>

      <VoucherMeta
        createdBy={settlement.createdBy}
        createdAt={settlement.createdAt}
        updatedBy={settlement.updatedBy}
        updatedAt={settlement.updatedAt}
      />

      {/* SettlementKind and ReviewLinkedType agree on PAYMENT / RECEIPT, so the
          kind names the review type directly. */}
      <ReviewPanel
        linkedType={kind}
        linkedId={settlement.id}
        noun={SETTLEMENT_KIND_LABELS[kind].toLowerCase()}
      />

      {canEdit(session.role) && (
        <DeleteVoucher
          action={deleteSettlement.bind(null, settlement.id, kind)}
          noun={SETTLEMENT_KIND_LABELS[kind].toLowerCase()}
          warning={
            isPayment
              ? "The ledger entry goes with it, so the supplier's balance returns to what we owed before this payment."
              : "The ledger entry goes with it, so the customer's balance returns to what they owed before this receipt."
          }
        />
      )}
    </div>
  );
}

export function settlementInitial(s: {
  party: { name: string; type: string };
  mode: string;
  amount: { toString(): string };
  date: Date;
  reference: string | null;
  notes: string | null;
}) {
  return {
    partyName: s.party.name,
    partyType: s.party.type as never,
    mode: s.mode as never,
    amount: s.amount.toString(),
    date: toInputDate(s.date),
    reference: s.reference ?? "",
    notes: s.notes ?? "",
  };
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 text-[13px]">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
