"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ListWindow } from "@/lib/paging";
import { partyFilterHref } from "@/lib/list-href";
import { Combobox } from "./combobox";

/**
 * Narrow a voucher list to one party, by typing part of their name.
 *
 * It was a `<select>` of every buyer, seller or vendor the centre has ever
 * dealt with. That list only grows, and the one wanted is somewhere inside it:
 * a merchant looking for SHREE MATHA MARINE scrolled past forty names to find
 * it, having known exactly what they wanted before they started.
 *
 * Choosing navigates. It used to call requestSubmit() on the surrounding form
 * in the same handler that set the state behind the hidden field — so the form
 * posted the value the field had BEFORE the choice, which on a first pick was
 * the empty string: ?party= , and a list that had filtered to nobody. React had
 * not re-rendered yet, and it never would have in time.
 *
 * Building the URL and pushing it depends on nothing having flushed. The form
 * around it stays exactly as it was, so the Show button and a browser with no
 * JavaScript still post the hidden field the ordinary way, and the clear link
 * is still a plain href.
 *
 * What is shown comes from `selected` — the URL — and never from state of its
 * own. These navigations are soft, so the component is not remounted and any
 * local copy would outlive the thing it was copying: pressing "clear" would
 * leave the party's name sitting in a box that no longer filters by it.
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
  const router = useRouter();

  if (parties.length === 0) return null;

  return (
    <form
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
        value={selected}
        onChange={(id) => {
          // Navigated from here rather than on every keystroke: the box is
          // being typed INTO while it narrows, and a list that reloaded under
          // each letter would throw away what was half typed.
          //
          // Built from `id` — the value just chosen — and never read back out
          // of the field, which at this instant still holds the old one.
          router.push(partyFilterHref(basePath, w, id));
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

export function VoucherFilter({
  basePath,
  window: w,
  parties,
  selected,
  billNo,
  label = "Party",
}: {
  basePath: string;
  window: ListWindow;
  parties: { id: string; name: string }[];
  selected: string;
  billNo: string;
  label?: string;
}) {
  const router = useRouter();
  const activeCount = (selected ? 1 : 0) + (billNo ? 1 : 0);

  return (
    <details className="mb-4 text-[13px]" open={activeCount > 0}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 border border-line-strong bg-surface px-3 py-1.5 font-medium hover:border-accent">
        <span aria-hidden="true">☷</span>
        Filter
        {activeCount > 0 && (
          <span className="text-accent">{activeCount}</span>
        )}
      </summary>
      <form
        method="get"
        action={basePath}
        className="mt-2 flex flex-wrap items-end gap-3 border border-line bg-surface p-3"
      >
        <input type="hidden" name="from" value={w.from} />
        <input type="hidden" name="to" value={w.to} />
        <input type="hidden" name="party" value={selected} />
        {parties.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-muted text-[12px]">{label}</span>
            <Combobox
              name="partyPicker"
              options={parties.map((p) => ({ id: p.id, label: p.name }))}
              value={selected}
              onChange={(id) => {
                const qs = new URLSearchParams({ from: w.from, to: w.to });
                if (id) qs.set("party", id);
                if (billNo) qs.set("billNo", billNo);
                router.push(`${basePath}?${qs.toString()}`);
              }}
              placeholder="Type a name…"
              emptyLabel="Everyone"
              compact
              className="w-64"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-muted text-[12px]">Bill No.</span>
          <input
            name="billNo"
            defaultValue={billNo}
            placeholder="Search bill number"
            className="border border-line-strong bg-surface px-3 py-1.5"
          />
        </label>
        <button
          type="submit"
          className="border border-line-strong px-3 py-1.5 font-medium hover:border-accent"
        >
          Apply
        </button>
        {activeCount > 0 && (
          <Link
            href={`${basePath}?from=${w.from}&to=${w.to}`}
            className="text-muted underline underline-offset-2"
          >
            Clear
          </Link>
        )}
      </form>
    </details>
  );
}
