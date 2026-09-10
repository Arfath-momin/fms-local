"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { ListWindow } from "@/lib/paging";
import { Combobox } from "./combobox";

/**
 * Narrow a voucher list to one party, by typing part of their name.
 *
 * It was a `<select>` of every buyer, seller or vendor the centre has ever
 * dealt with. That list only grows, and the one wanted is somewhere inside it:
 * a merchant looking for SHREE MATHA MARINE scrolled past forty names to find
 * it, having known exactly what they wanted before they started.
 *
 * Choosing submits. The Show button stays for anyone who tabs to it, and the
 * clear link is still a plain href so it works whatever happens to the box.
 *
 * The dates ride along as hidden fields rather than being rebuilt from the
 * URL, so changing the party keeps the window and changing the window keeps
 * the party — the two controls compose instead of resetting each other.
 */
export function PartyFilter({
  basePath,
  window: w,
  parties,
  selected,
  label = "Party",
}: {
  basePath: string;
  window: ListWindow;
  parties: { id: string; name: string }[];
  selected: string;
  label?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [party, setParty] = useState(selected);

  if (parties.length === 0) return null;

  return (
    <form
      ref={form}
      method="get"
      action={basePath}
      className="flex items-center gap-2 mb-4 text-[13px]"
    >
      <input type="hidden" name="from" value={w.from} />
      <input type="hidden" name="to" value={w.to} />
      <span className="text-muted text-[12px]">{label}</span>
      <Combobox
        name="party"
        options={parties.map((p) => ({ id: p.id, label: p.name }))}
        value={party}
        onChange={(id) => {
          setParty(id);
          // Submitted from here rather than on every keystroke: the box is
          // being typed INTO while it narrows, and a list that reloaded under
          // each letter would throw away what was half typed.
          // requestSubmit, not submit, so the form's own validation and the
          // GET action run exactly as a click on Show would.
          form.current?.requestSubmit();
        }}
        placeholder="Type a name…"
        emptyLabel="Everyone"
        compact
        className="w-64"
      />
      <button
        type="submit"
        className="border border-line-strong px-3 py-1.5 font-medium hover:bg-line-strong/10"
      >
        Show
      </button>
      {selected !== "" && (
        <Link
          href={`${basePath}?from=${w.from}&to=${w.to}`}
          className="text-accent underline underline-offset-2 text-[12px]"
        >
          clear
        </Link>
      )}
    </form>
  );
}
