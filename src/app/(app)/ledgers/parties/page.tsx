import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { sectionLedgers } from "@/lib/ledger-index";
import { LEDGER_PARTY_TYPES } from "@/lib/party";
import { LedgerTable } from "../ledger-list";
import { NoCentreNotice } from "../../no-centre";

/**
 * Every ledger in one list — the escape hatch for "I know the name, not the
 * category". The partitioned sections off /ledgers are the way in for everyday
 * use; this stays for search.
 *
 * Boats and Local sellers are absent by design: they are name registries, not
 * ledgers (see RECORD_ONLY_PARTY_TYPES), and listing them here filled the page
 * with rows that were permanently zero because nothing ever posts to them.
 */
export default async function PartyLedgersPage() {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const rows = await sectionLedgers(
    { companyId: company.id, centreId: centre.id },
    LEDGER_PARTY_TYPES
  );
  rows.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-2xl">
      <h1 className="heading text-xl font-semibold mt-1 mb-1">All Ledgers</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · {centre.name} · positive balance = party owes us.
      </p>

      <LedgerTable
        rows={rows}
        showType
        empty={`No ledgers have any activity in ${centre.name} yet.`}
      />
    </div>
  );
}
