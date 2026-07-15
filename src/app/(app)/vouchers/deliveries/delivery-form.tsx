"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { DeliveryFormState } from "./actions";
import type { DeliveryChannel, PartyType } from "@/generated/prisma/enums";

export type BuyerOption = { id: string; name: string; type: PartyType };
export type FishOption = { fishType: string; available: string };

const CHANNEL_OPTIONS: { value: DeliveryChannel; label: string }[] = [
  { value: "FACTORY", label: "Factory" },
  { value: "MARKET", label: "Market" },
  { value: "FISH_MILL", label: "Fish Mill" },
  { value: "LOCAL_SALE", label: "Local Sale" },
];

// Which party type usually buys through each channel — used only to order
// the buyer dropdown, never to restrict it.
const SUGGESTED_TYPE: Record<DeliveryChannel, PartyType> = {
  FACTORY: "FACTORY",
  MARKET: "MARKET_BUYER",
  FISH_MILL: "FISH_MILL",
  LOCAL_SALE: "LOCAL_BUYER",
};

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});

export function DeliveryForm({
  action,
  buyers,
  fishOptions,
  initial,
  submitLabel,
}: {
  action: (
    prev: DeliveryFormState,
    formData: FormData
  ) => Promise<DeliveryFormState>;
  buyers: BuyerOption[];
  fishOptions: FishOption[];
  initial?: {
    channel: DeliveryChannel;
    partyId: string;
    fishType: string;
    qtySent: string;
    rate: string;
    date: string;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<
    DeliveryFormState,
    FormData
  >(action, null);
  const [channel, setChannel] = useState<DeliveryChannel>(
    initial?.channel ?? "FACTORY"
  );
  const [qty, setQty] = useState(initial?.qtySent ?? "");
  const [rate, setRate] = useState(initial?.rate ?? "");
  const [fishType, setFishType] = useState(initial?.fishType ?? "");

  const today = new Date().toISOString().slice(0, 10);

  const { suggested, others } = useMemo(() => {
    const want = SUGGESTED_TYPE[channel];
    return {
      suggested: buyers.filter((b) => b.type === want),
      others: buyers.filter((b) => b.type !== want),
    };
  }, [buyers, channel]);

  const expected =
    Number(qty) > 0 && Number(rate) > 0 ? Number(qty) * Number(rate) : null;
  const selectedFish = fishOptions.find((f) => f.fishType === fishType);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="channel" className={labelCls}>
            Channel
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
        <label htmlFor="partyId" className={labelCls}>
          Buyer
        </label>
        <select
          id="partyId"
          name="partyId"
          required
          defaultValue={initial?.partyId ?? ""}
          className={inputCls}
        >
          <option value="" disabled>
            Select buyer…
          </option>
          {suggested.length > 0 && (
            <optgroup label="Suggested for this channel">
              {suggested.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="Other parties">
              {others.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="fishType" className={labelCls}>
            Fish Type
          </label>
          <select
            id="fishType"
            name="fishType"
            required
            value={fishType}
            onChange={(e) => setFishType(e.target.value)}
            className={inputCls}
          >
            <option value="" disabled>
              Select…
            </option>
            {fishOptions.map((f) => (
              <option key={f.fishType} value={f.fishType}>
                {f.fishType}
              </option>
            ))}
          </select>
          {selectedFish && (
            <p className="text-muted text-[12px] mt-1 num">
              {selectedFish.available} kg available
            </p>
          )}
        </div>
        <div>
          <label htmlFor="qtySent" className={labelCls}>
            Qty (kg)
          </label>
          <input
            id="qtySent"
            name="qtySent"
            required
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={inputCls + " num text-right"}
          />
        </div>
        <div>
          <label htmlFor="rate" className={labelCls}>
            Rate (₹/kg)
          </label>
          <input
            id="rate"
            name="rate"
            required
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={inputCls + " num text-right"}
          />
        </div>
      </div>

      <div className="border border-line bg-background px-4 py-3 text-[13px] flex justify-between">
        <span className="text-muted">
          Expected value (rate locks on save — settlement can only dispute
          quantity)
        </span>
        <span className="num font-semibold">
          {expected !== null ? inr.format(expected) : "—"}
        </span>
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
