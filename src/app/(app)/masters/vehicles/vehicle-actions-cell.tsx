"use client";

import { RetireButton } from "../retire-button";
import { archiveVehicle, deleteVehicle, unarchiveVehicle } from "./actions";

/**
 * The retire controls for one vehicle row. Same shape as the centre and party
 * cells: admin sees "Delete" and gets an archive, super admin sees restore and
 * the real delete, and the real delete is only offered on a truck that has
 * carried nothing.
 */
export function VehicleActionsCell({
  vehicleId,
  number,
  archived,
  trips,
  isSuperAdmin,
}: {
  vehicleId: string;
  number: string;
  archived: boolean;
  trips: number;
  isSuperAdmin: boolean;
}) {
  const unused = trips === 0;

  if (archived) {
    return (
      <div className="flex flex-col gap-1">
        {isSuperAdmin ? (
          <>
            <RetireButton
              action={unarchiveVehicle.bind(null, vehicleId)}
              label="Restore"
              pendingLabel="Restoring…"
              warning={`${number} goes back into the vehicle picker and can carry new trips again.`}
            />
            {unused && (
              <RetireButton
                action={deleteVehicle.bind(null, vehicleId)}
                label="Delete for good"
                pendingLabel="Deleting…"
                tone="danger"
                warning={`${number} has carried no trips at all, so it can be removed completely. This cannot be undone.`}
              />
            )}
          </>
        ) : (
          <span className="text-muted text-[12px]">Archived</span>
        )}
      </div>
    );
  }

  if (unused && isSuperAdmin) {
    return (
      <RetireButton
        action={deleteVehicle.bind(null, vehicleId)}
        label="Delete"
        pendingLabel="Deleting…"
        tone="danger"
        warning={`${number} has carried no trips at all, so it will be removed completely. This cannot be undone.`}
      />
    );
  }

  return (
    <RetireButton
      action={archiveVehicle.bind(null, vehicleId)}
      label="Delete"
      pendingLabel="Removing…"
      warning={
        unused
          ? `${number} will stop being offered when a trip is entered.`
          : `${number} will stop being offered on a new trip. Its ${trips} existing trip${trips === 1 ? "" : "s"} and the transporter ledgers reading them are unchanged.`
      }
    />
  );
}
