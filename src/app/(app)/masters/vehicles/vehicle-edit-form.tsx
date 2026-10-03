"use client";

import { useActionState, useState } from "react";
import { updateVehicle, type VehicleFormState } from "./actions";

const inputCls =
  "w-full border border-line-strong bg-surface px-2 py-1 text-[12px] outline-none focus:border-accent";

export function VehicleEditForm({
  vehicleId,
  number,
  transporterName,
  transporters,
}: {
  vehicleId: string;
  number: string;
  transporterName: string;
  transporters: string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<VehicleFormState, FormData>(
    updateVehicle.bind(null, vehicleId),
    null
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-accent underline underline-offset-2 text-[12px]"
      >
        Edit
      </button>
    );
  }

  return (
    <form action={formAction} className="min-w-56 space-y-1">
      <input name="number" defaultValue={number} required className={inputCls} />
      <input
        name="transporterName"
        defaultValue={transporterName}
        required
        list={`vehicle-transporter-${vehicleId}`}
        placeholder="Transporter"
        className={inputCls}
      />
      <datalist id={`vehicle-transporter-${vehicleId}`}>
        {transporters.map((name) => <option key={name} value={name} />)}
      </datalist>
      <div className="flex gap-2 text-[12px]">
        <button type="submit" disabled={pending} className="text-accent underline underline-offset-2">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-muted underline underline-offset-2">
          Cancel
        </button>
      </div>
      {state?.error && <p className="text-debit text-[12px]">{state.error}</p>}
    </form>
  );
}