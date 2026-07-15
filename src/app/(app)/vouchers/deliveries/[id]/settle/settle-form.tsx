"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { SettlementFormState } from "../../actions";
import type { DeliveryChannel } from "@/generated/prisma/enums";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});
const kg = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

export function SettleForm({
  action,
  channel,
  remaining,
  rate,
}: {
  action: (
    prev: SettlementFormState,
    formData: FormData
  ) => Promise<SettlementFormState>;
  channel: DeliveryChannel;
  remaining: string; // kg still unsettled
  rate: string; // locked ₹/kg
}) {
  const [state, formAction, pending] = useActionState<
    SettlementFormState,
    FormData
  >(action, null);

  const [accepted, setAccepted] = useState("");
  const [returned, setReturned] = useState("");
  const [spoiled, setSpoiled] = useState("");
  const [showDeductions, setShowDeductions] = useState(channel === "MARKET");

  const today = new Date().toISOString().slice(0, 10);

  const remainingNum = Number(remaining);
  const sum =
    (Number(accepted) || 0) + (Number(returned) || 0) + (Number(spoiled) || 0);
  const over = sum > remainingNum + 1e-9;
  const exact = Math.abs(sum - remainingNum) < 1e-9;
  const expectedForAccepted = (Number(accepted) || 0) * Number(rate);

  const qtyField = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    hint?: string
  ) => (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder="0"
        className={inputCls + " num text-right"}
      />
      {hint && <p className="text-muted text-[11px] mt-1">{hint}</p>}
    </div>
  );

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {qtyField("qtyAccepted", "Accepted (kg)", accepted, setAccepted)}
        {qtyField(
          "qtyReturned",
          "Returned (kg)",
          returned,
          setReturned,
          "goes back to available stock"
        )}
        {qtyField(
          "qtySpoiled",
          "Spoiled (kg)",
          spoiled,
          setSpoiled,
          "permanent loss — never returns"
        )}
      </div>

      {/* Live balance check (design doc #3) */}
      <div
        className={`border px-4 py-2.5 text-[13px] flex justify-between num font-semibold ${
          over
            ? "border-debit text-debit bg-[#fbeeed]"
            : exact
              ? "border-line text-credit bg-[#e7f2ec]"
              : "border-line bg-background"
        }`}
      >
        <span>
          Accepted + Returned + Spoiled = {kg.format(sum)} kg of{" "}
          {kg.format(remainingNum)} kg unsettled
        </span>
        <span>
          {over
            ? "exceeds remaining"
            : exact
              ? "fully settles the note"
              : `${kg.format(remainingNum - sum)} kg will stay in transit`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="amountReceived" className={labelCls}>
            {channel === "MARKET" ? "Net Received (₹, as billed)" : "Amount Received (₹)"}
          </label>
          <input
            id="amountReceived"
            name="amountReceived"
            required
            inputMode="decimal"
            className={inputCls + " num text-right"}
          />
          <p className="text-muted text-[11px] mt-1 num">
            expected for accepted qty: {inr.format(expectedForAccepted)}
          </p>
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
            defaultValue={today}
            className={inputCls}
          />
        </div>
      </div>

      {!showDeductions && (
        <button
          type="button"
          onClick={() => setShowDeductions(true)}
          className="text-accent text-[13px] underline underline-offset-2"
        >
          Add deductions (gross / commission / reserve)
        </button>
      )}

      {showDeductions && (
        <fieldset className="border border-line px-4 py-3 space-y-3">
          <legend className="text-[12px] uppercase tracking-wide text-muted font-semibold px-1">
            Deductions — entered as billed, never calculated
          </legend>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="gross" className={labelCls}>
                Gross (₹)
              </label>
              <input
                id="gross"
                name="gross"
                inputMode="decimal"
                className={inputCls + " num text-right"}
              />
            </div>
            <div>
              <label htmlFor="commission" className={labelCls}>
                Commission (₹)
              </label>
              <input
                id="commission"
                name="commission"
                inputMode="decimal"
                className={inputCls + " num text-right"}
              />
              <p className="text-muted text-[11px] mt-1">
                reference only — recorded, not posted
              </p>
            </div>
            <div>
              <label htmlFor="ownerReserve" className={labelCls}>
                Owner Reserve (₹)
              </label>
              <input
                id="ownerReserve"
                name="ownerReserve"
                inputMode="decimal"
                className={inputCls + " num text-right"}
              />
              <p className="text-muted text-[11px] mt-1">
                accumulates in the Owner Reserve account
              </p>
            </div>
          </div>
        </fieldset>
      )}

      {state?.error && <p className="text-debit text-[13px]">{state.error}</p>}

      <div className="flex gap-3 items-center">
        <button
          type="submit"
          disabled={pending || over || sum <= 0}
          className="bg-accent text-white px-5 py-2 text-[13px] font-semibold disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save Settlement"}
        </button>
        <Link
          href=".."
          className="text-muted text-[13px] underline underline-offset-2"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
