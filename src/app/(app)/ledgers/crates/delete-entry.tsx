"use client";

import { RetireButton } from "../../masters/retire-button";
import { deleteCrateEntry } from "../../vouchers/crates/actions";

/**
 * Remove one crate row.
 *
 * Reuses the masters' two-step confirm so the warning can say what actually
 * happens: nothing is "unposted", because crates were never in the trade
 * ledger. Every balance is derived from the rows, so removing one simply makes
 * the account read correctly again — including every later row's carried-down
 * figure, which is the reason the balance is not stored.
 */
export function DeleteCrateEntry({
  entryId,
  party,
}: {
  entryId: string;
  party: string;
}) {
  return (
    <RetireButton
      action={async (prev) => deleteCrateEntry(entryId, prev)}
      label="Remove"
      pendingLabel="Removing…"
      tone="danger"
      warning={`This row goes, and ${party}'s balance is worked out again from what is left. Nothing is unposted — crates are not in the trade ledger.`}
    />
  );
}
