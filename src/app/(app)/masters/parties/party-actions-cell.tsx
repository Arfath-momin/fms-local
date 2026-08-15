"use client";

import { RetireButton } from "../retire-button";
import { archiveParty, deleteParty, unarchiveParty } from "./actions";

/**
 * The retire controls for one party row.
 *
 * What an admin sees is a single "Delete", and it archives — the merchant does
 * not need the distinction, only the outcome: the name stops appearing. A super
 * admin sees the machinery underneath, because they are the one who has to
 * undo it.
 *
 * Deleting for real is offered only when `references` is zero, so the button on
 * screen always matches what the server will allow. The action re-counts before
 * it acts regardless — this page could be minutes stale.
 */
export function PartyActionsCell({
  partyId,
  name,
  archived,
  references,
  isSuperAdmin,
}: {
  partyId: string;
  name: string;
  archived: boolean;
  references: number;
  isSuperAdmin: boolean;
}) {
  const unused = references === 0;

  if (archived) {
    return (
      <div className="flex flex-col gap-1">
        {isSuperAdmin ? (
          <>
            <RetireButton
              action={unarchiveParty.bind(null, partyId)}
              label="Restore"
              pendingLabel="Restoring…"
              warning={`${name} goes back into the party pickers and the master list.`}
            />
            {unused && (
              <RetireButton
                action={deleteParty.bind(null, partyId)}
                label="Delete for good"
                pendingLabel="Deleting…"
                tone="danger"
                warning={`Nothing uses ${name}, so it can be removed completely. This cannot be undone.`}
              />
            )}
          </>
        ) : (
          <span className="text-muted text-[12px]">Archived</span>
        )}
      </div>
    );
  }

  // An unused party has no history to protect, so even an admin's "Delete"
  // can be the real thing rather than an archive.
  if (unused && isSuperAdmin) {
    return (
      <RetireButton
        action={deleteParty.bind(null, partyId)}
        label="Delete"
        pendingLabel="Deleting…"
        tone="danger"
        warning={`${name} has never been used on a voucher, so it will be removed completely. This cannot be undone.`}
      />
    );
  }

  return (
    <RetireButton
      action={archiveParty.bind(null, partyId)}
      label="Delete"
      pendingLabel="Removing…"
      warning={
        unused
          ? `${name} will stop appearing when entering vouchers.`
          : `${name} will stop appearing when entering vouchers. It stays on the ${references} record${references === 1 ? "" : "s"} that already use it, and its ledger is unchanged.`
      }
    />
  );
}
