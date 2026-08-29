"use client";

import { useActionState, useState } from "react";
import type { ReserveFormState } from "./actions";
import { SETTLEMENT_MODES, SETTLEMENT_MODE_LABELS } from "@/lib/settlement";
import { businessToday, fmtMoney } from "@/lib/format";
import type { FormScope } from "@/lib/scope";
import { PartyCombobox } from "../../masters/party-combobox";
import { ScopeFields } from "../scope-fields";
import { DateField } from "../../date-field";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

/** What each market party still holds, so the form can show and cap it. */
export type ReserveHolding = { partyName: string; outstanding: number };

export function ReserveCollectionForm({
  kind,
  label,
  action,
  holdings,
  scope,
}: {
  action: (
    prev: ReserveFormState,
    formData: FormData
  ) => Promise<ReserveFormState>;
  holdings: ReserveHolding[];
  /** Which balance this clears — travels to the server in a hidden field. */
  kind: "RESERVE" | "CUTTING";
  label: string;
  scope: FormScope;
}) {
  const [state, formAction, pending] = useActionState<
    ReserveFormState,
    FormData
  >(action, null);
  const [partyName, setPartyName] = useState("");
  const today = businessToday();

  // What this party is recorded as holding. Shown the moment they are picked,
  // so the clerk is entering against a figure rather than from memory.
  const held = holdings.find(
    (h) => h.partyName.toLowerCase() === partyName.trim().toLowerCase()
  );

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <ScopeFields scope={scope} />
      <input type="hidden" name="kind" value={kind} />

      <div>
        <PartyCombobox
          name="partyName"
          label="Market party"
          types={["MARKET_BUYER"]}
          value={partyName}
          onValueChange={setPartyName}
          placeholder={`Who is paying the ${label.toLowerCase()} back`}
        />
        {partyName.trim() !== "" && (
          <p
            className={
              "text-[12px] mt-1 " + (held ? "text-muted" : "text-debit")
            }
          >
            {held
              ? `Holds ${fmtMoney(held.outstanding)} of ${label.toLowerCase()}.`
              : `No ${label.toLowerCase()} recorded against this party yet.`}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="amount" className={labelCls}>
            Amount (₹)
          </label>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            className={inputCls + " num text-right"}
          />
        </div>
        <div>
          <label htmlFor="date" className={labelCls}>
            Collected on
          </label>
          <DateField
            id="date"
            name="date"
            required
            defaultValue={today}
            className={inputCls}
          />
          {/* Worth saying plainly: every other voucher's date is the buying
              day, and this one is not. */}
          <p className="text-muted text-[12px] mt-1">
            The day the money actually arrived — not a buying day.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="mode" className={labelCls}>
            How
          </label>
          <select id="mode" name="mode" required className={inputCls}>
            {SETTLEMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {SETTLEMENT_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="reference" className={labelCls}>
            Reference
          </label>
          <input id="reference" name="reference" className={inputCls} />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className={labelCls}>
          Notes (optional)
        </label>
        <input id="notes" name="notes" className={inputCls} />
      </div>

      {state?.error && <p className="text-debit text-[13px]">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-white px-5 py-2 text-[13px] font-semibold disabled:opacity-60"
      >
        {pending ? "Saving…" : "Record collection"}
      </button>
    </form>
  );
}
