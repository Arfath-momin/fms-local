"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { PartyFormState } from "./actions";
import type { PartyType } from "@/generated/prisma/enums";

const TYPE_OPTIONS: { value: PartyType; label: string }[] = [
  { value: "SOCIETY", label: "Society" },
  { value: "PRIVATE_SELLER", label: "Private Seller" },
  { value: "BOAT", label: "Boat" },
  { value: "MARKET_BUYER", label: "Market Buyer" },
  { value: "FACTORY", label: "Factory" },
  { value: "FISH_MILL", label: "Fish Mill" },
  { value: "LOCAL_BUYER", label: "Local Buyer" },
];

export function PartyForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: PartyFormState, formData: FormData) => Promise<PartyFormState>;
  initial?: { name: string; type: PartyType; contactInfo: string | null };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<PartyFormState, FormData>(
    action,
    null
  );

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <div>
        <label htmlFor="name" className="block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={initial?.name}
          className="w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div>
        <label htmlFor="type" className="block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">
          Type
        </label>
        <select
          id="type"
          name="type"
          required
          defaultValue={initial?.type ?? ""}
          className="w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="" disabled>
            Select type…
          </option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="contactInfo" className="block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">
          Contact (optional)
        </label>
        <input
          id="contactInfo"
          name="contactInfo"
          defaultValue={initial?.contactInfo ?? ""}
          className="w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
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
          href="/masters/parties"
          className="text-muted text-[13px] underline underline-offset-2"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
