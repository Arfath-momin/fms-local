"use client";

import { useActionState, useEffect, useRef } from "react";
import { createVehicle, type VehicleFormState } from "./actions";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export function VehicleCreateForm({
  transporters,
}: {
  /** Existing transporter names, for the datalist. */
  transporters: string[];
}) {
  const [state, formAction, pending] = useActionState<
    VehicleFormState,
    FormData
  >(createVehicle, null);
  const ref = useRef<HTMLFormElement>(null);

  // Clear after a successful add (the action redirects, but on the
  // no-redirect error path we keep whatever was typed).
  useEffect(() => {
    if (!pending && !state) ref.current?.reset();
  }, [pending, state]);

  return (
    <form action={formAction} ref={ref} className="flex items-end gap-2 flex-wrap">
      <div className="flex-1 min-w-[10rem]">
        <label htmlFor="number" className={labelCls}>
          Vehicle number
        </label>
        <input
          id="number"
          name="number"
          required
          placeholder="KA-20-B-5521"
          className={inputCls}
        />
        <p className="text-muted text-[12px] mt-1">
          Spaces and dashes are ignored — the same truck typed two ways is one
          truck.
        </p>
      </div>
      <div className="flex-1 min-w-[10rem]">
        <label htmlFor="transporterName" className={labelCls}>
          Transporter
        </label>
        {/* A datalist rather than a select: the list is short, and a new truck
            usually arrives with a transporter nobody has entered yet. */}
        <input
          id="transporterName"
          name="transporterName"
          required
          list="transporter-names"
          placeholder="Who owns it"
          className={inputCls}
        />
        <datalist id="transporter-names">
          {transporters.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <p className="text-muted text-[12px] mt-1">
          Each trip&rsquo;s rent is owed to them.
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-white px-5 py-2 text-[13px] font-semibold disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add vehicle"}
      </button>
      {state?.error && (
        <p className="text-debit text-[13px] basis-full">{state.error}</p>
      )}
    </form>
  );
}
