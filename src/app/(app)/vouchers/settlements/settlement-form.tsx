"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { PartyType, SettlementKind, SettlementMode } from "@/generated/prisma/enums";
import { businessToday, fmtMoney } from "@/lib/format";
import {
  SETTLEMENT_KIND_LABELS,
  SETTLEMENT_MODES,
  SETTLEMENT_MODE_LABELS,
  SETTLEMENT_PARTY_TYPES,
  SETTLEMENT_PATH,
} from "@/lib/settlement";
import { PartyCombobox, type PartyOption } from "../../masters/party-combobox";
import type { SettlementFormState } from "./actions";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export type SettlementInit = {
  partyName: string;
  partyType: PartyType;
  mode: SettlementMode;
  amount: string;
  date: string;
  reference: string;
  notes: string;
};

export function SettlementForm({
  kind,
  action,
  initial,
  submitLabel,
}: {
  kind: SettlementKind;
  action: (
    prev: SettlementFormState,
    formData: FormData
  ) => Promise<SettlementFormState>;
  initial?: SettlementInit;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<
    SettlementFormState,
    FormData
  >(action, null);
  const [party, setParty] = useState<PartyOption | null>(null);
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const today = businessToday();

  // Positive balance = the party owes us. A receipt reduces that; a payment
  // settles what we owe, which is a negative balance.
  const outstanding = party?.balance ?? 0;
  const entered = Number(amount);
  const delta = Number.isFinite(entered) ? entered : 0;
  const after =
    kind === "RECEIPT" ? outstanding - delta : outstanding + delta;

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <PartyCombobox
        name="partyName"
        typeFieldName="partyType"
        label={kind === "PAYMENT" ? "Paid to" : "Received from"}
        types={SETTLEMENT_PARTY_TYPES[kind]}
        defaultValue={initial?.partyName ?? ""}
        defaultType={initial?.partyType}
        placeholder="Start typing a name…"
        onSelect={setParty}
      />

      {/* The whole point of recording settlement separately: you can see the
          position you are settling against before committing to a figure. */}
      {party && (
        <div className="border border-line-strong bg-surface px-4 py-3 text-[13px] space-y-1">
          <div className="flex justify-between">
            <span className="text-muted">Previous balance</span>
            <span
              className={`num font-semibold ${
                outstanding > 0
                  ? "text-debit"
                  : outstanding < 0
                    ? "text-credit"
                    : ""
              }`}
            >
              {fmtMoney(Math.abs(outstanding))}{" "}
              {outstanding > 0
                ? "receivable"
                : outstanding < 0
                  ? "payable"
                  : "settled"}
            </span>
          </div>
          <div className="flex justify-between border-t border-line pt-1">
            <span className="text-muted">
              After this {SETTLEMENT_KIND_LABELS[kind].toLowerCase()}
            </span>
            <span
              className={`num font-semibold ${
                after > 0 ? "text-debit" : after < 0 ? "text-credit" : ""
              }`}
            >
              {fmtMoney(Math.abs(after))}{" "}
              {after > 0 ? "receivable" : after < 0 ? "payable" : "settled"}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="amount" className={labelCls}>
            Amount (₹)
          </label>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputCls + " num text-right"}
          />
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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="mode" className={labelCls}>
            Mode
          </label>
          <select
            id="mode"
            name="mode"
            defaultValue={initial?.mode ?? "CASH"}
            className={inputCls}
          >
            {SETTLEMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {SETTLEMENT_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="reference" className={labelCls}>
            Reference (optional)
          </label>
          <input
            id="reference"
            name="reference"
            defaultValue={initial?.reference ?? ""}
            placeholder="Cheque / UPI ref"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className={labelCls}>
          Notes (optional)
        </label>
        <input
          id="notes"
          name="notes"
          defaultValue={initial?.notes ?? ""}
          className={inputCls}
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
          href={SETTLEMENT_PATH[kind]}
          className="text-muted text-[13px] underline underline-offset-2"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
