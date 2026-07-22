"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { SettlementFormState } from "../../actions";
import { fmtMoney } from "@/lib/format";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export function SettleForm({
  action,
}: {
  action: (
    prev: SettlementFormState,
    formData: FormData
  ) => Promise<SettlementFormState>;
}) {
  const [state, formAction, pending] = useActionState<SettlementFormState, FormData>(
    action,
    null
  );
  const [amount, setAmount] = useState("");
  const [amountReceived, setAmountReceived] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const balance = Math.max((Number(amount) || 0) - (Number(amountReceived) || 0), 0);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
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

      <div className="border border-line-strong bg-surface p-3">
        <p className={labelCls}>Settlement</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="amount" className={labelCls}>
              Total Amount (₹)
            </label>
            <input
              id="amount"
              name="amount"
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls + " num text-right"}
            />
          </div>
          <div>
            <label htmlFor="amountReceived" className={labelCls}>
              Amount Received (₹)
            </label>
            <input
              id="amountReceived"
              name="amountReceived"
              required
              inputMode="decimal"
              value={amountReceived}
              onChange={(e) => setAmountReceived(e.target.value)}
              className={inputCls + " num text-right"}
            />
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 text-[12px]">
          <button
            type="button"
            onClick={() => setAmountReceived(amount)}
            className="text-accent underline underline-offset-2"
          >
            Mark fully received
          </button>
          <p className={balance > 0 ? "text-debit font-semibold" : "text-muted"}>
            Balance: {fmtMoney(balance)}
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="bill" className={labelCls}>
          Settlement Bill (upload)
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
          {pending ? "Saving…" : "Save Settlement"}
        </button>
        <Link href=".." className="text-muted text-[13px] underline underline-offset-2">
          Cancel
        </Link>
      </div>
    </form>
  );
}
