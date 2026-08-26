import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { sectionLedgers, totalBalance } from "@/lib/ledger-index";
import {
  FIXED_PURCHASE_PARTY,
  PURCHASE_LEDGER_TYPES,
} from "@/lib/party";
import { balanceClass, LedgerTable, SectionHeader } from "../ledger-list";
import { NoCentreNotice } from "../../no-centre";

/**
 * Who we buy from, and what is still owed to each of them.
 *
 * Society and KFDC are one counterparty each however many boats they send;
 * private owners get a ledger apiece; Local purchases roll into one account.
 * The boat is a column on the statement inside, never a ledger of its own.
 */
export default async function PurchasePartyLedgersPage() {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const standing = Object.values(FIXED_PURCHASE_PARTY) as string[];
  const rows = await sectionLedgers(
    { companyId: company.id, centreId: centre.id },
    PURCHASE_LEDGER_TYPES,
    standing
  );

  // The standing accounts sit at the top in a fixed order — they are the ones
  // read every day — and the private parties follow alphabetically.
  const rank = (name: string) => {
    const i = standing.indexOf(name);
    return i === -1 ? standing.length : i;
  };
  rows.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

  const total = totalBalance(rows);

  return (
    <div className="max-w-2xl">
      <div className="mt-1">
        <SectionHeader
          title="Purchase Parties"
          scope={`${company.name} · ${centre.name} · negative = we owe them.`}
          totalLabel="Net position"
          total={total}
          totalClass={balanceClass(total)}
        />
      </div>

      <LedgerTable
        rows={rows}
        empty={`No purchases recorded for ${company.name} · ${centre.name} yet.`}
      />

      <p className="text-muted text-[12px] mt-3">
        Boats are recorded on each purchase and named on every statement line,
        but they carry no ledger — the money is owed to the party, not to the
        vessel.
      </p>
    </div>
  );
}
