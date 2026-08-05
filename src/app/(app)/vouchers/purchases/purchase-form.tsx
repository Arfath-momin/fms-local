"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { PurchaseFormState } from "./actions";
import type { PurchaseType } from "@/generated/prisma/enums";
import { businessToday, fmtMoney } from "@/lib/format";
import { BillUpload } from "../bill-upload";
import { PartyCombobox } from "../../masters/party-combobox";
import {
  FIXED_PURCHASE_PARTY,
  PURCHASE_BOAT_TYPE,
  purchasePartyIsTyped,
} from "@/lib/party";

const TYPE_OPTIONS: { value: PurchaseType; label: string }[] = [
  { value: "SOCIETY", label: "Society" },
  { value: "KFDC", label: "KFDC" },
  { value: "PRIVATE", label: "Private" },
  { value: "LOCAL", label: "Local" },
];

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export type PurchaseLineInit = {
  particular: string;
  qtyKg: string;
  pricePerKg: string;
};

export type PurchaseInit = {
  type: PurchaseType;
  /** Ledger party — only editable on Private, fixed by the type otherwise. */
  partyName: string;
  /** Boat (Society/KFDC/Private) or seller name (Local). */
  boatName: string;
  amount: string;
  date: string;
  lines: PurchaseLineInit[];
};

const BLANK_LINE: PurchaseLineInit = { particular: "", qtyKg: "", pricePerKg: "" };

export function PurchaseForm({
  action,
  initial,
  submitLabel,
  reasonField,
  existingAttachments = 0,
}: {
  action: (
    prev: PurchaseFormState,
    formData: FormData
  ) => Promise<PurchaseFormState>;
  initial?: PurchaseInit;
  submitLabel: string;
  reasonField?: boolean;
  existingAttachments?: number;
}) {
  const [state, formAction, pending] = useActionState<PurchaseFormState, FormData>(
    action,
    null
  );
  const [type, setType] = useState<PurchaseType>(initial?.type ?? "SOCIETY");
  const [lines, setLines] = useState<PurchaseLineInit[]>(
    initial?.lines?.length ? initial.lines : [BLANK_LINE]
  );

  const today = businessToday();
  const isLocal = type === "LOCAL";
  // Society / KFDC / Private track the boat; Local tracks the seller. Same map
  // the server action resolves with, so the picker can never offer a party
  // kind the save would then reject.
  const boatType = PURCHASE_BOAT_TYPE[type];
  // Private is the only type without a standing counterparty, so it is the
  // only one that asks who the money is owed to.
  const asksForParty = purchasePartyIsTyped(type);
  const fixedParty = FIXED_PURCHASE_PARTY[type];

  const grandTotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = Number(l.qtyKg);
        const p = Number(l.pricePerKg);
        return sum + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
      }, 0),
    [lines]
  );

  const setLine = (i: number, patch: Partial<PurchaseLineInit>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="type" className={labelCls}>
            Purchase Type
          </label>
          <select
            id="type"
            name="type"
            required
            value={type}
            onChange={(e) => setType(e.target.value as PurchaseType)}
            className={inputCls}
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
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

      {/* Private buys from a different owner each time, so the ledger is named
          here. The others settle against one standing account, which the type
          already picks — asking again would only invite a typo that splits it. */}
      {asksForParty && (
        <div>
          <PartyCombobox
            name="partyName"
            label="Party Name"
            types={["PURCHASE_GROUP"]}
            // Only a purchase that was already Private has a party worth
            // restoring; switching type on an edit must not prefill "Society"
            // into the field that names a private owner.
            defaultValue={initial?.type === "PRIVATE" ? initial.partyName : ""}
            placeholder="e.g. Ravi Traders"
          />
          <p className="text-muted text-[12px] mt-1">
            The private party this purchase is owed to. They get their own
            ledger, and payments settle against it.
          </p>
        </div>
      )}

      {/* Keyed on the purchase type so switching Society ↔ Local re-runs the
          search against the right master and clears a name from the other. */}
      <div>
        <PartyCombobox
          key={boatType}
          name="boatName"
          label={isLocal ? "Seller Name" : "Boat Name"}
          types={[boatType]}
          defaultValue={initial?.boatName ?? ""}
          placeholder={isLocal ? "e.g. Ramesh" : "e.g. Boat No. 12"}
        />
        <p className="text-muted text-[12px] mt-1">
          {asksForParty ? (
            <>
              Which boat the fish came from. Recorded on this bill and shown
              against the line on the party&rsquo;s statement — it carries no
              ledger of its own.
            </>
          ) : (
            <>
              Recorded on this bill and shown against every line of the{" "}
              <span className="font-medium">{fixedParty}</span> ledger, which is
              where the money is owed.
            </>
          )}
        </p>
      </div>

      {isLocal ? (
        <div>
          <label className={labelCls}>Items</label>
          <div className="border border-line-strong bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-[12px] uppercase tracking-wide">
                  <th className="text-left font-semibold px-3 py-2">Particular</th>
                  <th className="text-right font-semibold px-3 py-2 w-28">Qty (kg)</th>
                  <th className="text-right font-semibold px-3 py-2 w-28">Price/kg</th>
                  <th className="text-right font-semibold px-3 py-2 w-32">Total</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const rowTotal =
                    (Number(l.qtyKg) || 0) * (Number(l.pricePerKg) || 0);
                  return (
                    <tr key={i} className="border-t border-line">
                      <td className="px-2 py-1">
                        <input
                          name="particular"
                          value={l.particular}
                          onChange={(e) =>
                            setLine(i, { particular: e.target.value })
                          }
                          className={inputCls}
                          placeholder="e.g. Prawn"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          name="qtyKg"
                          inputMode="decimal"
                          value={l.qtyKg}
                          onChange={(e) => setLine(i, { qtyKg: e.target.value })}
                          className={inputCls + " num text-right"}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          name="pricePerKg"
                          inputMode="decimal"
                          value={l.pricePerKg}
                          onChange={(e) =>
                            setLine(i, { pricePerKg: e.target.value })
                          }
                          className={inputCls + " num text-right"}
                        />
                      </td>
                      <td className="px-3 py-1 num text-right text-muted">
                        {fmtMoney(rowTotal)}
                      </td>
                      <td className="px-1 py-1 text-center">
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setLines((ls) => ls.filter((_, j) => j !== i))
                            }
                            className="text-debit text-lg leading-none"
                            aria-label="Remove line"
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong">
                  <td colSpan={3} className="px-3 py-2 text-right font-semibold">
                    Grand Total
                  </td>
                  <td className="px-3 py-2 num text-right font-semibold text-debit">
                    {fmtMoney(grandTotal)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, { ...BLANK_LINE }])}
            className="mt-2 border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold hover:border-accent"
          >
            + Add item
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="amount" className={labelCls}>
              Grand Total (₹)
            </label>
            <input
              id="amount"
              name="amount"
              required
              inputMode="decimal"
              defaultValue={initial?.amount ?? ""}
              className={inputCls + " num text-right"}
            />
          </div>
        </div>
      )}

      <BillUpload
        label="Bill / Receipt"
        hint={
          isLocal
            ? "Optional."
            : "The fish breakdown stays on the bill image, so attach it here."
        }
        existingCount={existingAttachments}
      />

      {reasonField && (
        <div>
          <label htmlFor="reason" className={labelCls}>
            Reason for correction (optional)
          </label>
          <input id="reason" name="reason" className={inputCls} />
        </div>
      )}

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
          href="/vouchers/purchases"
          className="text-muted text-[13px] underline underline-offset-2"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
