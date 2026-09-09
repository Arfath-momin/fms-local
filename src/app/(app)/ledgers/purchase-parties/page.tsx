import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { sectionLedgers, totalBalance } from "@/lib/ledger-index";
import {
  FIXED_PURCHASE_PARTY,
  PURCHASE_LEDGER_TYPES,
} from "@/lib/party";
import { groupPurchaseParties } from "@/lib/purchase";
import {
  balanceClass,
  LedgerTable,
  SectionHeader,
  type LedgerGroup,
} from "../ledger-list";
import { NoCentreNotice } from "../../no-centre";

/**
 * Who we buy from, and what is still owed to each of them.
 *
 * Society and KFDC are one counterparty each however many boats they send.
 * Private and local sellers get a ledger apiece — pooling them was wrong, since
 * owing Ravi 40,000 and Raju 50,000 is not owing 90,000 to a group nobody can
 * pay — so the list is grouped by which of the four a seller sells through.
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
  // read every day — and everyone else follows alphabetically.
  const rank = (name: string) => {
    const i = standing.indexOf(name);
    return i === -1 ? standing.length : i;
  };
  rows.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

  /**
   * Filed by what they sell through, not run together in one alphabet.
   *
   * Society and KFDC are one account each and stay at the top unheaded, where
   * they are looked up every day. Private and Local are a different question —
   * each is a list of individuals that grows every season, and a merchant
   * asking "who have I still to pay for local fish" was reading a single
   * A-to-Z column and picking the names out by memory. Now each kind is its
   * own section with its own subtotal.
   */
  const groups: LedgerGroup[] = groupPurchaseParties(rows, standing);

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
        groups={groups}
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
