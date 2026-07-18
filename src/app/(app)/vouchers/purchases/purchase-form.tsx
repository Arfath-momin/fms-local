"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { PurchaseFormState } from "./actions";
import type { PartyType, PurchaseType } from "@/generated/prisma/enums";
import { PURCHASE_SELLER_TYPES } from "@/lib/party";

export type PartyOption = { id: string; name: string; type: PartyType };

const TYPE_OPTIONS: { value: PurchaseType; label: string }[] = [
  { value: "SOCIETY", label: "Society" },
  { value: "PRIVATE", label: "Private" },
  { value: "LOCAL", label: "Local" },
];

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

export function PurchaseForm({
  action,
  parties,
  fishTypes,
  initial,
  submitLabel,
  reasonField,
}: {
  action: (
    prev: PurchaseFormState,
    formData: FormData
  ) => Promise<PurchaseFormState>;
  parties: PartyOption[];
  fishTypes: string[];
  initial?: {
    type: PurchaseType;
    partyId: string;
    invoiceNumber: string;
    fishType: string;
    qtyKg: string;
    amount: string;
    date: string;
  };
  submitLabel: string;
  reasonField?: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    PurchaseFormState,
    FormData
  >(action, null);
  const [type, setType] = useState<PurchaseType>(initial?.type ?? "SOCIETY");

  const today = new Date().toISOString().slice(0, 10);

  // Only seller-side parties, per purchase type. An existing entry's party
  // stays selectable even if its type no longer matches.
  const sellers = useMemo(() => {
    const allowed = PURCHASE_SELLER_TYPES[type];
    return parties.filter(
      (p) => allowed.includes(p.type) || p.id === initial?.partyId
    );
  }, [parties, type, initial?.partyId]);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
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

      <div>
        <label htmlFor="partyId" className={labelCls}>
          Party (seller)
        </label>
        <select
          id="partyId"
          name="partyId"
          required
          defaultValue={initial?.partyId ?? ""}
          className={inputCls}
        >
          <option value="" disabled>
            Select party…
          </option>
          {sellers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {sellers.length === 0 && (
          <p className="text-debit text-[12px] mt-1">
            No parties of the right type for this purchase.{" "}
            <Link href="/masters" className="underline underline-offset-2">
              Add one in Masters
            </Link>
            .
          </p>
        )}
      </div>

      <div>
        <label htmlFor="invoiceNumber" className={labelCls}>
          Invoice Number
          {type === "LOCAL" && (
            <span className="normal-case font-normal">
              {" "}
              — leave blank to auto-number (LOC-AUTO-####)
            </span>
          )}
        </label>
        <input
          id="invoiceNumber"
          name="invoiceNumber"
          required={type !== "LOCAL"}
          defaultValue={initial?.invoiceNumber ?? ""}
          placeholder={type === "LOCAL" ? "LOC-AUTO-…" : ""}
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="fishType" className={labelCls}>
            Fish Type
          </label>
          <input
            id="fishType"
            name="fishType"
            required
            list="fish-types"
            defaultValue={initial?.fishType ?? ""}
            className={inputCls}
          />
          <datalist id="fish-types">
            {fishTypes.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
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
            defaultValue={initial?.qtyKg ?? ""}
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
            defaultValue={initial?.amount ?? ""}
            className={inputCls + " num text-right"}
          />
        </div>
      </div>

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
