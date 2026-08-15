"use client";

import { RetireButton } from "../retire-button";
import { archiveCentre, deleteCentre, unarchiveCentre } from "./actions";

/**
 * The retire controls for one centre row. Same shape as the party cell — admin
 * sees "Delete" and gets an archive, super admin sees restore and the real
 * delete — with one addition: the last remaining live centre offers nothing at
 * all, because archiving it would leave nowhere to enter vouchers.
 */
export function CentreActionsCell({
  centreId,
  name,
  archived,
  references,
  isSuperAdmin,
  isLastLive,
}: {
  centreId: string;
  name: string;
  archived: boolean;
  references: number;
  isSuperAdmin: boolean;
  isLastLive: boolean;
}) {
  const unused = references === 0;

  if (archived) {
    return (
      <div className="flex flex-col gap-1">
        {isSuperAdmin ? (
          <>
            <RetireButton
              action={unarchiveCentre.bind(null, centreId)}
              label="Restore"
              pendingLabel="Restoring…"
              warning={`${name} goes back into the centre switcher and can be entered into again.`}
            />
            {unused && (
              <RetireButton
                action={deleteCentre.bind(null, centreId)}
                label="Delete for good"
                pendingLabel="Deleting…"
                tone="danger"
                warning={`${name} holds no records at all, so it can be removed completely. This cannot be undone.`}
              />
            )}
          </>
        ) : (
          <span className="text-muted text-[12px]">Archived</span>
        )}
      </div>
    );
  }

  if (isLastLive) {
    return (
      <span className="text-muted text-[12px] normal-case">
        Only active centre
      </span>
    );
  }

  if (unused && isSuperAdmin) {
    return (
      <RetireButton
        action={deleteCentre.bind(null, centreId)}
        label="Delete"
        pendingLabel="Deleting…"
        tone="danger"
        warning={`${name} holds no records at all, so it will be removed completely. This cannot be undone.`}
      />
    );
  }

  return (
    <RetireButton
      action={archiveCentre.bind(null, centreId)}
      label="Delete"
      pendingLabel="Removing…"
      warning={
        unused
          ? `${name} will be taken out of the centre switcher.`
          : `${name} will be taken out of the centre switcher, so nothing new can be entered into it. Its ${references} existing record${references === 1 ? "" : "s"} and every ledger and report reading them are unchanged.`
      }
    />
  );
}
