"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { DirectSaleFormState } from "./actions";
import type { PartyType } from "@/generated/prisma/enums";

export type BuyerOption = { id: string; name: string; type: PartyType };
export type FishOption = { fishType: string; available: string };

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export function DirectSaleForm({
  action,
  buyers,
  fishOptions,
  initial,
  submitLabel,
}: {
  action: (
    prev: DirectSaleFormState,
    formData: FormData
  ) => Promise<DirectSaleFormState>;
  buyers: BuyerOption[];
  fishOptions: FishOption[];
  initial?: {
    partyId: string;
    fishType: string;
    qtyKg: string;
    rate: string;
    amount: string;
    date: string;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<
    DirectSaleFormState,
    FormData
  >(action, null);

  const [fishType, setFishType] = useState(initial?.fishType ?? "");
  const [qty, setQty] = useState(initial?.qtyKg ?? "");
  const [rate, setRate] = useState(initial?.rate ?? "");
  // Amount follows qty × rate until the user types their own figure.
  const [amountTouched, setAmountTouched] = useState(Boolean(initial));
  const [amount, setAmount] = useState(initial?.amount ?? "");

  const today = new Date().toISOString().slice(0, 10);

  const computed = useMemo(() => {
    const n = (Number(qty) || 0) * (Number(rate) || 0);
    return n > 0 ? n.toFixed(2) : "";
  }, [qty, rate]);
  const amountValue = amountTouched ? amount : computed;

  const { locals, others } = useMemo(
    () => ({
      locals: buyers.filter((b) => b.type === "LOCAL_BUYER"),
      others: buyers.filter((b) => b.type !== "LOCAL_BUYER"),
    }),
    [buyers]
  );

  const selectedFish = fishOptions.find((f) => f.fishType === fishType);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="grid grid-cols-2 gap-4">
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
            {locals.length > 0 && (
              <optgroup label="Local buyers">
                {locals.map((b) => (
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

      <div className="grid grid-cols-4 gap-4">
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
            <p className="text-muted text-[11px] mt-1 num">
              {selectedFish.available} kg available
            </p>
          )}
        </div>
        <div>
          <label htmlFor="qtyKg" className={labelCls}>
            Qty (kg)
          </label>
          <input
            id="qtyKg"
            name="qtyKg"
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
        <div>
          <label htmlFor="amount" className={labelCls}>
            Amount (₹)
          </label>
          <input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            value={amountValue}
            onChange={(e) => {
              setAmountTouched(true);
              setAmount(e.target.value);
            }}
            className={inputCls + " num text-right"}
          />
        </div>
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
          href="/vouchers/direct-sales"
          className="text-muted text-[13px] underline underline-offset-2"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
