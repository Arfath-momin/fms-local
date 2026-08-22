"use client";

import { RetireButton } from "../../masters/retire-button";
import { deleteReserveCollection } from "../../vouchers/reserve-collections/actions";

/**
 * Remove one reserve collection.
 *
 * Reuses the masters' two-step confirm so the warning can say what actually
 * happens — nothing is "unposted", because reserve never sat in the ledger.
 * The party's derived balance simply goes back up.
 */
export function DeleteCollection({
  collectionId,
  party,
  amount,
}: {
  collectionId: string;
  party: string;
  amount: string;
}) {
  return (
    <RetireButton
      action={async (prev) =>
        deleteReserveCollection(collectionId, prev)
      }
      label="Remove"
      pendingLabel="Removing…"
      tone="danger"
      warning={`${party} goes back to holding this ${amount}. Nothing is unposted — reserve is not in the trade ledger.`}
    />
  );
}
