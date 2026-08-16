"use client";

import { useActionState, useState } from "react";
import { COMPANY_COLOURS } from "@/lib/company-theme";
import { BillUpload } from "../../vouchers/bill-upload";
import {
  removeCompanyLogo,
  type CompanyFormState,
} from "./actions";

export type CompanyInit = {
  id: string;
  name: string;
  colour: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  contactPerson: string;
  gstin: string;
  hasLogo: boolean;
};

const inputCls =
  "w-full border border-line-strong bg-background px-2 py-1.5 text-sm outline-none focus:border-accent";
const labelCls = "block text-[12px] font-semibold mb-1";

function Result({ state }: { state: CompanyFormState }) {
  if (!state) return null;
  if ("error" in state)
    return <p className="text-debit text-[13px] mt-2">{state.error}</p>;
  return <p className="text-credit text-[13px] mt-2">{state.ok}</p>;
}

/**
 * Add or edit a company.
 *
 * Only the short name and the colour are required. Everything else is
 * letterhead, and a company routinely has to exist before anyone has gathered
 * its GSTIN — making those mandatory would mean inventing values to get past
 * the form, which is worse than leaving them blank.
 */
export function CompanyForm({
  action,
  initial,
  submitLabel,
  defaultColour,
}: {
  action: (
    prev: CompanyFormState,
    formData: FormData
  ) => Promise<CompanyFormState>;
  initial?: CompanyInit;
  submitLabel: string;
  /** Pre-picked unused colour, so a new company is distinct without thought. */
  defaultColour?: string;
}) {
  const [state, formAction, pending] = useActionState<
    CompanyFormState,
    FormData
  >(action, null);
  const [colour, setColour] = useState(
    initial?.colour ?? defaultColour ?? COMPANY_COLOURS[0].value
  );

  return (
    <form
      action={formAction}
      className="border border-line-strong bg-surface p-4 max-w-2xl"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>
            Short name{" "}
            <span className="font-normal text-muted">— shown in the app</span>
          </span>
          <input
            name="name"
            required
            maxLength={24}
            defaultValue={initial?.name ?? ""}
            placeholder="BFM"
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className={labelCls}>
            Legal name{" "}
            <span className="font-normal text-muted">— printed on bills</span>
          </span>
          <input
            name="legalName"
            defaultValue={initial?.legalName ?? ""}
            placeholder="Bismillah Fish Merchants"
            className={inputCls}
          />
        </label>
      </div>

      {/* Colour is identity, not decoration: the band and switcher chip are how
          you know whose books are on screen before reading a single figure. */}
      <fieldset className="mt-3">
        <legend className={labelCls}>Colour</legend>
        <div className="flex flex-wrap gap-2">
          {COMPANY_COLOURS.map((c) => (
            <label
              key={c.value}
              title={c.label}
              className={
                "flex items-center gap-1.5 border px-2 py-1 text-[12px] cursor-pointer " +
                (colour === c.value
                  ? "border-accent font-semibold"
                  : "border-line-strong hover:border-accent")
              }
            >
              <input
                type="radio"
                name="colour"
                value={c.value}
                checked={colour === c.value}
                onChange={() => setColour(c.value)}
                className="sr-only"
              />
              <span
                aria-hidden
                className="inline-block h-4 w-4 border border-black/20"
                style={{ background: c.value }}
              />
              {c.label}
            </label>
          ))}
        </div>
        <div
          className="mt-2 px-3 py-1.5 text-[12px] font-bold tracking-widest uppercase"
          style={{ background: colour, color: "#fff" }}
        >
          Preview — this is the band
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2 mt-3">
        <label className="block">
          <span className={labelCls}>Contact person</span>
          <input
            name="contactPerson"
            defaultValue={initial?.contactPerson ?? ""}
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={labelCls}>Phone</span>
          <input
            name="phone"
            inputMode="tel"
            defaultValue={initial?.phone ?? ""}
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={labelCls}>Email</span>
          <input
            name="email"
            type="email"
            defaultValue={initial?.email ?? ""}
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={labelCls}>GSTIN</span>
          <input
            name="gstin"
            defaultValue={initial?.gstin ?? ""}
            placeholder="29ABCDE1234F1Z5"
            className={inputCls + " uppercase"}
          />
        </label>
      </div>

      <label className="block mt-3">
        <span className={labelCls}>Address</span>
        <textarea
          name="address"
          rows={3}
          defaultValue={initial?.address ?? ""}
          placeholder={"Shop 12, Fish Market Road\nMangalore 575001"}
          className={inputCls + " resize-y"}
        />
      </label>

      <div className="mt-3">
        <BillUpload
          name="logo"
          label="Logo"
          hint="Optional — printed on bills and delivery notes, and shown in the app."
          existingCount={initial?.hasLogo ? 1 : 0}
        />
        {initial?.hasLogo && (
          <div className="mt-2 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/company-logo/${initial.id}`}
              alt={`${initial.name} logo`}
              className="h-12 w-12 object-contain border border-line bg-background"
            />
            <RemoveLogo companyId={initial.id} />
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-4 bg-accent text-white px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>

      <Result state={state} />
    </form>
  );
}

/**
 * Its own form, because a nested <form> is invalid HTML — clearing the logo
 * has to post separately from saving the rest of the company.
 */
function RemoveLogo({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState<CompanyFormState, FormData>(
    removeCompanyLogo.bind(null, companyId),
    null
  );
  return (
    <span>
      <button
        type="button"
        onClick={() => action(new FormData())}
        disabled={pending}
        className="text-debit underline underline-offset-2 text-[12px] disabled:opacity-60"
      >
        {pending ? "Removing…" : "Remove logo"}
      </button>
      {state && "error" in state && (
        <span className="text-debit text-[12px] ml-2">{state.error}</span>
      )}
    </span>
  );
}
