import Link from "next/link";
import {
  PAGE_SIZE,
  activePreset,
  listHref,
  presetRange,
  type ListWindow,
  type PresetKind,
} from "@/lib/paging";
import { businessToday } from "@/lib/format";
import { DateField } from "./date-field";

// Shared controls for the voucher and ledger lists. Both are plain server
// components: the filter is a GET form and the pager is a pair of links, so the
// whole thing works with no client JavaScript and every view is a real URL that
// can be bookmarked, shared, or opened in a second tab.

export function DateWindow({
  basePath,
  window: w,
  keep,
}: {
  basePath: string;
  window: ListWindow;
  /**
   * Other filters in force, carried through every link and form here.
   *
   * Without it, narrowing to one party and then clicking "This week" would
   * silently drop the party — the merchant would be looking at everybody's week
   * while believing they were looking at one seller's.
   */
  keep?: Record<string, string>;
}) {
  const extra = Object.entries(keep ?? {}).filter(([, v]) => v !== "");
  const carry = extra.map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  const hidden = extra.map(([k, v]) => (
    <input key={k} type="hidden" name={k} value={v} />
  ));
  const active = activePreset(w);
  const [thisYear, thisMonth] = businessToday().split("-").map(Number);
  // The picker opens on the window actually being shown, not on today: a
  // merchant who asked for one day in August and then wants the day after
  // should not have to set the month again.
  const [wYear, wMonth, wDay] = w.from.split("-").map(Number);
  const singleDay = w.from === w.to;
  const dayInWindow = singleDay ? String(wDay) : "";
  // Enough history to reach any book a merchant still argues about, and this
  // year. Offering years with nothing in them is clutter, but guessing which
  // ones have data would cost a query on every list.
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  const preset = (kind: PresetKind, label: string) => {
    const r = presetRange(kind);
    return (
      <Link
        key={kind}
        href={`${basePath}?from=${r.from}&to=${r.to}${carry}`}
        className={
          "border px-3 py-1.5 font-medium " +
          (active === kind
            ? "border-accent text-accent"
            : "border-line-strong hover:bg-line-strong/10")
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="mb-4 text-[13px]">
      {/* The four periods anybody names out loud. Plain links, so they work
          without JavaScript and can be bookmarked or sent to somebody. */}
      <div className="flex flex-wrap items-center gap-2">
        {preset("today", "Today")}
        {preset("week", "This week")}
        {preset("month", "This month")}
        {preset("year", "This year")}

        {/* Its own form, submitting only day, month and year. Keeping it
            separate from the range below is what stops the two disagreeing:
            whichever control was used is the only one that sends anything. */}
        <form
          method="get"
          action={basePath}
          className="flex items-center gap-1 ml-auto"
        >
          {hidden}
          <select
            name="month"
            defaultValue={String(wMonth || thisMonth)}
            aria-label="Month"
            className="border border-line-strong bg-surface px-2 py-1.5"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            name="year"
            defaultValue={String(wYear || thisYear)}
            aria-label="Year"
            className="border border-line-strong bg-surface px-2 py-1.5"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {/* After the year, and empty by default. One day was reachable only
              by typing the same date into both boxes of the range form below —
              "1 Sept 2026 to 1 Sept 2026" — every time somebody wanted a single
              day's notes. Leaving it on "All month" is the behaviour that was
              there before, so nothing changes for anyone who ignores it.

              31 is always offered rather than the month's real length: the
              month can be changed after the day, and a list that silently
              renumbered itself under the cursor is worse than one that falls
              back to the whole month for a date that does not exist. */}
          <select
            name="day"
            defaultValue={dayInWindow}
            aria-label="Day"
            className="border border-line-strong bg-surface px-2 py-1.5"
          >
            <option value="">All month</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="border border-line-strong px-3 py-1.5 font-medium hover:bg-line-strong/10"
          >
            Show
          </button>
        </form>
      </div>

      {/* Still here, still the same two fields and the same ?from=&to=, so
          every link already bookmarked resolves to what it always did. Folded
          away because it is the rare case now, not the only one. */}
      <details className="mt-2">
        <summary className="text-muted text-[12px] cursor-pointer">
          {active ? "Or pick exact dates" : `Showing ${w.from} to ${w.to}`}
        </summary>
        <form
          method="get"
          action={basePath}
          className="flex items-end gap-2 mt-2"
        >
          {hidden}
          <label className="flex flex-col gap-1">
            <span className="text-muted text-[12px]">From</span>
            <DateField
              name="from"
              defaultValue={w.from}
              className="border border-line-strong bg-surface px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-[12px]">To</span>
            <DateField
              name="to"
              defaultValue={w.to}
              className="border border-line-strong bg-surface px-2 py-1"
            />
          </label>
          <button
            type="submit"
            className="border border-line-strong px-3 py-1.5 font-medium hover:bg-line-strong/10"
          >
            Apply
          </button>
        </form>
      </details>
    </div>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function Pager({
  basePath,
  window: w,
  total,
}: {
  basePath: string;
  window: ListWindow;
  total: number;
}) {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : w.skip + 1;
  const lastRow = Math.min(w.skip + PAGE_SIZE, total);

  // One page of results needs no controls, but the count is still worth stating
  // so it is obvious the list is windowed rather than complete.
  if (total <= PAGE_SIZE) {
    return (
      <p className="text-muted text-[12px] mt-2">
        {total} {total === 1 ? "entry" : "entries"} between {w.from} and {w.to}.
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between mt-2 text-[12px]">
      <span className="text-muted">
        Showing {firstRow}–{lastRow} of {total} between {w.from} and {w.to}.
      </span>
      <span className="flex items-center gap-3">
        {w.page > 1 ? (
          <Link
            href={listHref(basePath, w, { page: w.page - 1 })}
            className="text-accent underline underline-offset-2"
          >
            ← Previous
          </Link>
        ) : (
          <span className="text-muted opacity-50">← Previous</span>
        )}
        <span className="text-muted">
          Page {w.page} of {lastPage}
        </span>
        {w.page < lastPage ? (
          <Link
            href={listHref(basePath, w, { page: w.page + 1 })}
            className="text-accent underline underline-offset-2"
          >
            Next →
          </Link>
        ) : (
          <span className="text-muted opacity-50">Next →</span>
        )}
      </span>
    </div>
  );
}

/**
 * Narrow a list to one party.
 *
 * A merchant looking for what they bought from one society, or every bill to
 * one market, was reading a whole month and picking the rows out by eye.
 *
 * A GET form carrying the date window in hidden fields, so choosing a party
 * keeps the period you were looking at — and DateWindow carries the party back
 * the other way, so the two controls compose instead of undoing each other.
 */

// Lives in its own file because it is interactive — the party box narrows as
// you type, which a server component cannot do. Re-exported here so the four
// list pages carry on importing their controls from one place.
export { PartyFilter } from "./party-filter";
