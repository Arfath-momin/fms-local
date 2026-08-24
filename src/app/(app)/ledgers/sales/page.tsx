import Link from "next/link";
import type { PartyType } from "@/generated/prisma/enums";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { sectionLedgers, totalBalance, type LedgerRow } from "@/lib/ledger-index";
import { SALE_LEDGER_TYPES } from "@/lib/party";
import { fmtMoney } from "@/lib/format";
import { balanceClass, LedgerTable, SectionHeader } from "../ledger-list";
import { NoCentreNotice } from "../../no-centre";

/**
 * Buyers, split by the sale category they trade under. The categories are the
 * merchant's own vocabulary — a Fish Mill account is read differently from a
 * Market one — so grouping by them beats one alphabetical list where a mill,
 * a factory and a walk-in buyer sit side by side.
 */
const GROUPS: { type: PartyType; label: string; note: string }[] = [
  {
    type: "MARKET_BUYER",
    label: "Market",
    note: "Sold on the market floor — they owe us the net bill.",
  },
  { type: "FISH_MILL", label: "Fish Mill", note: "Mills buying by delivery note." },
  { type: "FACTORY", label: "Factory", note: "Factories buying by delivery note." },
  { type: "LOCAL_BUYER", label: "Local", note: "Local counter sales." },
  {
    type: "CARE_OF",
    label: "CareOf Agents",
    note: "Agents who settle on the buyer's behalf; the sale still names the real buyer.",
  },
];

export default async function SaleLedgersPage() {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const rows = await sectionLedgers(
    { companyId: company.id, centreId: centre.id },
    SALE_LEDGER_TYPES
  );

  const byType = new Map<PartyType, LedgerRow[]>();
  for (const r of rows) {
    const list = byType.get(r.type);
    if (list) list.push(r);
    else byType.set(r.type, [r]);
  }

  const total = totalBalance(rows);

  return (
    <div className="max-w-2xl">
      <Link
        href="/ledgers"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Ledgers
      </Link>
      <div className="mt-1">
        <SectionHeader
          title="Sale Ledgers"
          scope={`${company.name} · ${centre.name} · positive = they owe us.`}
          totalLabel="Total receivable"
          total={total}
          totalClass={balanceClass(total)}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3">
          No sales recorded for {company.name} · {centre.name} yet.
        </p>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => {
            const list = byType.get(g.type) ?? [];
            // A category with no ledgers here is not a gap to explain — the
            // merchant simply does not trade it at this centre.
            if (list.length === 0) return null;
            const subtotal = totalBalance(list);
            return (
              <section key={g.type}>
                <div className="flex items-baseline justify-between flex-wrap gap-3 mb-1">
                  <h2 className="heading text-[15px] font-semibold">
                    {g.label}
                    <span className="text-muted font-normal text-[12px]">
                      {" "}
                      · {list.length} ledger{list.length > 1 ? "s" : ""}
                    </span>
                  </h2>
                  <span
                    className={`num text-[13px] font-semibold ${balanceClass(subtotal)}`}
                  >
                    {fmtMoney(subtotal)}
                  </span>
                </div>
                <p className="text-muted text-[12px] mb-2">{g.note}</p>
                <LedgerTable rows={list} empty="" />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
