"use client";

import { useId, useRef, useState } from "react";
import { useEscapeLayer } from "../keys/escape-layer";

/**
 * Find a trip by typing its number.
 *
 * It was a plain `<select>` listing every open trip newest first. That works
 * until a delivery note is raised against an OLD buying day: it sorts by that
 * day, so it lands near the bottom of a list of forty, and the merchant who
 * entered it two minutes ago cannot find it.
 *
 * So: the five most recent when the box is empty, and a search as soon as
 * anything is typed. "88" finds DN-00088 — the match is on any part of the
 * number, because nobody says "DN zero zero zero eight eight" out loud, they
 * say eighty-eight.
 *
 * The vehicle and the buying day are searchable too. A merchant who remembers
 * the truck but not the number should not have to go and look it up.
 */

export type PickableTrip = {
  id: string;
  billNo: string;
  /** yyyy-mm-dd. */
  date: string;
  vehicleNumber: string;
  boxesDispatched: number;
};

/** How many to show before anything is typed. */
const RECENT = 5;

/**
 * Trips matching `query`, or the most recent when it is empty.
 *
 * Exported for its own test: which trip a merchant can find is the whole point
 * of this control, and it is worth pinning rather than eyeballing.
 */
export function matchTrips<T extends PickableTrip>(
  trips: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return trips.slice(0, RECENT);
  return trips.filter((t) =>
    `${t.billNo} ${t.vehicleNumber} ${t.date}`.toLowerCase().includes(q)
  );
}

export function TripPicker({
  trips,
  value,
  onChange,
  label = "Trip (optional)",
  emptyLabel = "No trip — this bill stands on its own",
}: {
  trips: PickableTrip[];
  /** The chosen trip's id, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  label?: string;
  emptyLabel?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const chosen = trips.find((t) => t.id === value) ?? null;
  const shown = matchTrips(trips, query);

  // Escape closes the list before it does anything else — the same stack the
  // rest of the app's overlays use, so one press does one thing.
  useEscapeLayer(open, () => setOpen(false));

  const choose = (tripId: string) => {
    onChange(tripId);
    setQuery("");
    setOpen(false);
  };

  const describe = (t: PickableTrip) =>
    `${t.date} · ${t.billNo} · ${t.vehicleNumber}` +
    (t.boxesDispatched > 0 ? ` · ${t.boxesDispatched} boxes` : "");

  return (
    <div
      className="relative"
      ref={boxRef}
      onBlur={(e) => {
        // Closing on blur only when focus has actually left the control —
        // otherwise clicking an option closes the list before the click lands.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <label htmlFor={id} className="block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">
        {label}
      </label>

      {/* What posts. The visible box is for finding a trip; this carries the
          one that was found. */}
      <input type="hidden" name="deliveryNoteId" value={value} />

      <input
        id={id}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        value={open ? query : chosen ? describe(chosen) : ""}
        placeholder={chosen ? "" : "Type a number — 88 finds DN-00088"}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open) {
            // Enter picks the highlighted trip rather than submitting the
            // voucher — saving a bill from a dropdown nobody meant to confirm
            // is how a half-filled voucher gets posted.
            e.preventDefault();
            if (active === 0) choose("");
            else if (shown[active - 1]) choose(shown[active - 1].id);
          }
        }}
        className="w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />

      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto border border-line-strong bg-surface shadow-lg"
        >
          <Option
            active={active === 0}
            onPick={() => choose("")}
            onHover={() => setActive(0)}
            text={emptyLabel}
            muted
          />
          {shown.map((t, i) => (
            <Option
              key={t.id}
              active={active === i + 1}
              onPick={() => choose(t.id)}
              onHover={() => setActive(i + 1)}
              text={describe(t)}
            />
          ))}
          {shown.length === 0 && query.trim() !== "" && (
            <li className="px-3 py-2 text-[13px] text-muted">
              No trip matches “{query.trim()}”.
            </li>
          )}
          {!query.trim() && trips.length > RECENT && (
            <li className="px-3 py-2 text-[12px] text-muted border-t border-line">
              {RECENT} most recent of {trips.length}. Type to search the rest.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Option({
  active,
  onPick,
  onHover,
  text,
  muted = false,
}: {
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  text: string;
  muted?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        // onMouseDown, not onClick: blur fires first on a click and would close
        // the list before the click ever lands on the option.
        onMouseDown={(e) => {
          e.preventDefault();
          onPick();
        }}
        onMouseEnter={onHover}
        className={
          "block w-full text-left px-3 py-2 text-[13px] " +
          (active ? "bg-background " : "") +
          (muted ? "text-muted" : "")
        }
      >
        {text}
      </button>
    </li>
  );
}
