"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { PurchaseFormState } from "./actions";
import type { PurchaseType } from "@/generated/prisma/enums";
import { businessToday, fmtKg, fmtMoney } from "@/lib/format";
import type { FormScope } from "@/lib/scope";
import { BillUpload } from "../bill-upload";
import { ScopeFields } from "../scope-fields";
import { DateField } from "../../date-field";
import { PartyCombobox } from "../../masters/party-combobox";
import {
  FIXED_PURCHASE_PARTY,
  purchaseHasLineBoats,
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
const cellCls =
  "w-full border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export type PurchaseLineInit = {
  /** Society / KFDC only — the vessel this row's fish came from. */
  boatName: string;
  particular: string;
  qtyKg: string;
  pricePerKg: string;
};

export type PurchaseInit = {
  /** Free-form remark, on every voucher type. */
  notes: string;
  type: PurchaseType;
  /** "No." on a Society/KFDC bill, "Invoice No." on a Private/Local one. */
  billNo: string;
  /** The seller — Private and Local only; fixed by the type otherwise. */
  partyName: string;
  date: string;
  lines: PurchaseLineInit[];
};

const BLANK_LINE: PurchaseLineInit = {
  boatName: "",
  particular: "",
  qtyKg: "",
  pricePerKg: "",
};

/**
 * Every purchase is an itemised bill. The type decides two things and nothing
 * else: whether each row names its own boat (Society / KFDC do, because one
 * bill covers whatever vessels landed that day), and whether the bill names its
 * seller (Private / Local do, because they buy from a different person each
 * time — and that person gets the ledger).
 *
 * The grand total is never typed. It is the sum of the rows, computed here for
 * the person entering it and recomputed server-side from the same rows, so the
 * figure on screen and the figure in the ledger cannot disagree.
 */
export function PurchaseForm({
  action,
  nextNos,
  initial,
  submitLabel,
  reasonField,
  existingAttachments = 0,
  allowBillUpload = true,
  scope,
}: {
  /** Previews for the two series a purchase can take: PP and LP. */
  nextNos?: Record<string, string>;
  action: (
    prev: PurchaseFormState,
    formData: FormData
  ) => Promise<PurchaseFormState>;
  initial?: PurchaseInit;
  submitLabel: string;
  reasonField?: boolean;
  existingAttachments?: number;
  /**
   * False on a voucher that already exists, where the Attachments panel below
   * the form is the place images are managed. Rendering both put two file
   * pickers on one screen for the same job.
   */
  allowBillUpload?: boolean;
  scope: FormScope;
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
  const hasLineBoats = purchaseHasLineBoats(type);
  const asksForParty = purchasePartyIsTyped(type);
  // Private and Local have no supplier bill behind them, so BFM issues the
  // number. Society and KFDC carry the society's own.
  const issuesOwnNumber = type === "PRIVATE" || type === "LOCAL";
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

  /**
   * The kilos on the voucher, added up as they are typed.
   *
   * The foot totalled the money and not the weight, so a clerk entering 100,
   * 200 and 150 could see what the day cost but had to add the kilos in their
   * head to check it against the boats — on the one figure the seller is being
   * paid per unit of.
   */
  const grandKg = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = Number(l.qtyKg);
        return sum + (Number.isFinite(q) ? q : 0);
      }, 0),
    [lines]
  );

  const setLine = (i: number, patch: Partial<PurchaseLineInit>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      <ScopeFields scope={scope} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          <label htmlFor="billNo" className={labelCls}>
            {issuesOwnNumber ? "Voucher No." : "Invoice No."}
          </label>
          {/* A Private or Local purchase has no supplier bill to copy a number
              from, so BFM issues one — PP-00001 / LP-00001. A Society or KFDC
              bill arrives with the society's own number, which stays typed: it
              is what they quote back when there is a query. */}
          {issuesOwnNumber ? (
            <>
              <div className="border border-line bg-background px-3 py-2 text-sm num">
                {initial?.billNo ||
                  nextNos?.[type === "PRIVATE" ? "PP" : "LP"] ||
                  `${type === "PRIVATE" ? "PP" : "LP"}-…`}
              </div>
              {!initial?.billNo && (
                <p className="text-muted text-[12px] mt-1">
                  Next in the series — confirmed when you save.
                </p>
              )}
            </>
          ) : (
            <input
              id="billNo"
              name="billNo"
              defaultValue={initial?.billNo ?? ""}
              placeholder="From the society's bill"
              className={inputCls}
            />
          )}
        </div>
        <div>
          <label htmlFor="date" className={labelCls}>
            Date
          </label>
          <DateField
            id="date"
            name="date"
            required
            defaultValue={initial?.date ?? today}
            className={inputCls}
          />
        </div>
      </div>

      {/* Private and Local buy from a different person each time, so the ledger
          is named here and that person is who a payment settles against.
          Society and KFDC settle against one standing account, which the type
          already picks — asking again would only invite a typo that splits it. */}
      {asksForParty ? (
        <div>
          <PartyCombobox
            name="partyName"
            label="Name"
            types={["PURCHASE_GROUP"]}
            // Suggestions follow the type selected above: a Private bill offers
            // private sellers, a Local bill local ones. Switching the type
            // re-runs the search, so the list never lags the choice.
            purchaseKind={type}
            // Only a purchase that already named its own seller has a name
            // worth restoring; switching type on an edit must not prefill
            // "Society" into the field that names an individual.
            defaultValue={
              initial && purchasePartyIsTyped(initial.type)
                ? initial.partyName
                : ""
            }
            placeholder="e.g. Ravi"
          />
          <p className="text-muted text-[12px] mt-1">
            Who this bill is owed to. They get their own ledger, and payments
            settle against it — two sellers are never rolled into one balance.
          </p>
        </div>
      ) : (
        <p className="text-muted text-[12px]">
          Owed to <span className="font-medium">{fixedParty}</span>, which is one
          standing account however many boats it sends. Name the boats on the
          rows below.
        </p>
      )}

      <div>
        <label className={labelCls}>Items</label>
        <div className="items-scroll border border-line-strong bg-surface">
          <table
            className={"w-full text-sm " + (hasLineBoats ? "min-w-[720px]" : "")}
          >
            <thead>
              <tr className="items-head text-muted text-[12px] uppercase tracking-wide">
                <th className="text-left font-semibold px-2 py-2 w-10">Sl</th>
                {hasLineBoats && (
                  <th className="text-left font-semibold px-2 py-2">Boat Name</th>
                )}
                <th className="text-left font-semibold px-2 py-2">
                  {hasLineBoats ? "Particulars" : "Particular"}
                </th>
                {/* The same two headings on every purchase type.
                
                    A Society or KFDC line said "Total Kg" and "Rate/kg" while a
                    Private or Local one said "Qty" and "Rate" — for the same
                    two columns, holding the same two figures, in the same
                    units. The column is qtyKg and the price is per kilo
                    whoever the fish came from; only the wording differed, and
                    "Qty" left the clerk to guess whether it wanted kilos, boxes
                    or pieces. */}
                <th className="text-right font-semibold px-2 py-2 w-28">
                  Total Kg
                </th>
                <th className="text-right font-semibold px-2 py-2 w-28">
                  Rate/kg
                </th>
                <th className="text-right font-semibold px-2 py-2 w-32">Amount</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const rowTotal =
                  (Number(l.qtyKg) || 0) * (Number(l.pricePerKg) || 0);
                return (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="px-2 py-2 num text-muted">{i + 1}</td>
                    {hasLineBoats && (
                      <td className="px-1 py-1">
                        <PartyCombobox
                          name="boatName"
                          label={`Boat name, row ${i + 1}`}
                          types={["BOAT"]}
                          compact
                          required={false}
                          value={l.boatName}
                          onValueChange={(v) => setLine(i, { boatName: v })}
                          placeholder="e.g. Boat No. 12"
                        />
                      </td>
                    )}
                    <td className="px-1 py-1">
                      <input
                        name="particular"
                        aria-label={`Particulars, row ${i + 1}`}
                        value={l.particular}
                        onChange={(e) =>
                          setLine(i, { particular: e.target.value })
                        }
                        className={cellCls}
                        placeholder="e.g. Prawn"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        name="qtyKg"
                        aria-label={`Quantity, row ${i + 1}`}
                        inputMode="decimal"
                        value={l.qtyKg}
                        onChange={(e) => setLine(i, { qtyKg: e.target.value })}
                        className={cellCls + " num text-right"}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        name="pricePerKg"
                        aria-label={`Rate, row ${i + 1}`}
                        inputMode="decimal"
                        value={l.pricePerKg}
                        onChange={(e) =>
                          setLine(i, { pricePerKg: e.target.value })
                        }
                        className={cellCls + " num text-right"}
                      />
                    </td>
                    <td className="px-2 py-2 num text-right text-muted">
                      {fmtMoney(rowTotal)}
                    </td>
                    <td className="px-1 py-2 text-center">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setLines((ls) => ls.filter((_, j) => j !== i))
                          }
                          className="text-debit text-lg leading-none"
                          aria-label={`Remove row ${i + 1}`}
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
              {/* Each total sits UNDER the column it totals, rather than the
                  label stretching across to leave the money alone at the end.
                  A merchant checking a voucher reads down a column, not across
                  a row. */}
              <tr className="border-t border-line-strong">
                <td
                  colSpan={hasLineBoats ? 3 : 2}
                  className="px-3 py-2 text-right font-semibold"
                >
                  Total
                </td>
                <td className="px-2 py-2 num text-right font-semibold">
                  {grandKg > 0 ? fmtKg(grandKg) : "—"}
                </td>
                <td></td>
                <td className="px-2 py-2 num text-right font-semibold text-debit">
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

      {/* Free-form remark, on every voucher type. Read by no ledger, no
          balance and no report — it is what the entering clerk wanted the next
          person to know, and it prints on the document. */}
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

      {allowBillUpload && (
        <BillUpload
          label="Bill / Receipt"
          hint="Optional — the rows above are the record now."
          existingCount={existingAttachments}
        />
      )}

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
