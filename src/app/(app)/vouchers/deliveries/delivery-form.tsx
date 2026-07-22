"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { DeliveryFormState } from "./actions";
import type { DeliveryChannel } from "@/generated/prisma/enums";

const CHANNEL_OPTIONS: { value: DeliveryChannel; label: string }[] = [
  { value: "MARKET", label: "Market" },
  { value: "FACTORY", label: "Factory" },
  { value: "FISH_MILL", label: "Fish Mill" },
  { value: "LOCAL", label: "Local" },
];

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export type DeliveryInit = {
  channel: DeliveryChannel;
  buyerName: string;
  vehicleNo: string;
  date: string;
};

export function DeliveryForm({
  action,
  initial,
  submitLabel,
}: {
  action: (
    prev: DeliveryFormState,
    formData: FormData
  ) => Promise<DeliveryFormState>;
  initial?: DeliveryInit;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<DeliveryFormState, FormData>(
    action,
    null
  );
  const [channel, setChannel] = useState<DeliveryChannel>(
    initial?.channel ?? "MARKET"
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="channel" className={labelCls}>
            Type
          </label>
          <select
            id="channel"
            name="channel"
            required
            value={channel}
            onChange={(e) => setChannel(e.target.value as DeliveryChannel)}
            className={inputCls}
          >
            {CHANNEL_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="date" className={labelCls}>
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            defaultValue={initial?.date ?? today}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label htmlFor="vehicleNo" className={labelCls}>
          Vehicle No
        </label>
        <input
          id="vehicleNo"
          name="vehicleNo"
          required
          defaultValue={initial?.vehicleNo ?? ""}
          placeholder="e.g. KA-01-AB-1234"
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="buyerName" className={labelCls}>
          Buyer{" "}
          <span className="normal-case font-normal">
            (optional — leave blank to track under “{CHANNEL_OPTIONS.find((c) => c.value === channel)?.label}”)
          </span>
        </label>
        <input
          id="buyerName"
          name="buyerName"
          defaultValue={initial?.buyerName ?? ""}
          placeholder="e.g. Coastal Exports"
          className={inputCls}
        />
        <p className="text-muted text-[12px] mt-1">
          Each buyer keeps its own ledger, built from settlement bills.
        </p>
      </div>

      <div>
        <label htmlFor="bill" className={labelCls}>
          Delivery Note (upload)
        </label>
        <input
          id="bill"
          name="bill"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="text-[13px]"
        />
      </div>

      {state?.error && <p className="text-debit text-[13px]">{state.error}</p>}

      <div className="flex gap-3 items-center">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white px-5 py-2 text-[13px] font-semibold disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link
          href="/vouchers/deliveries"
          className="text-muted text-[13px] underline underline-offset-2"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
