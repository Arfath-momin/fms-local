"use client";

import { useId, useState } from "react";
import { useEscapeLayer } from "./keys/escape-layer";

/**
 * Find something in a long list by typing part of it.
 *
 * A `<select>` is fine for five options and useless for eighty. The truck a
 * rent voucher is for, and the party a list is filtered to, are both picked
 * from masters that only ever grow: by the time there are forty trucks, the
 * one wanted is somewhere in a scroll box, and the merchant knows its number
 * but has to hunt for it by eye.
 *
 * The interaction is the one the trip picker already proved: type to narrow,
 * arrows to move, Enter to take the highlighted row, Escape to close the list
 * before it does anything else.
 *
 * Matching ignores everything that is not a letter or a digit, on BOTH sides.
 * Vehicle numbers are written "KA20B5521" by one person and "KA 20 B 5521" by
 * the next, and a search that made those two different strings would fail on
 * exactly the field it exists for.
 */

export type ComboOption = {
  id: string;
  /** What the row reads as, and the first thing matched against. */
  label: string;
  /** Matched too, never shown — an owner's name behind a lorry number. */
  keywords?: string;
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The options matching `query`, or the first `limit` when it is empty.
 *
 * Exported for its own test: which row a merchant can reach by typing is the
 * whole point of the control, and it is worth pinning rather than eyeballing.
 */
export function matchOptions<T extends ComboOption>(
  options: T[],
  query: string,
  limit?: number
): T[] {
  const q = squash(query);
  if (!q) return limit === undefined ? options : options.slice(0, limit);
  return options.filter((o) => squash(`${o.label} ${o.keywords ?? ""}`).includes(q));
}

export function Combobox({
  options,
  value,
  onChange,
  label,
  id: idProp,
  name,
  placeholder = "Type to search…",
  emptyLabel,
  limit,
  compact = false,
  className = "",
}: {
  options: ComboOption[];
  /** The chosen option's id, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  /** Omit inside a filter bar where a heading already says what this is. */
  label?: string;
  id?: string;
  /** When set, a hidden input of this name carries the chosen id into a form. */
  name?: string;
  placeholder?: string;
  /** The "none" row at the top. Omit and there is no way to choose nothing. */
  emptyLabel?: string;
  /** How many to show before anything is typed. Undefined shows them all. */
  limit?: number;
  compact?: boolean;
  className?: string;
}) {
  const generated = useId();
  const id = idProp ?? generated;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const chosen = options.find((o) => o.id === value) ?? null;
  const shown = matchOptions(options, query, limit);
  const rows = emptyLabel === undefined ? shown.length : shown.length + 1;

  // Escape closes the list before it does anything else — the same stack the
  // rest of the app's overlays use, so one press does one thing.
  useEscapeLayer(open, () => setOpen(false));

  const choose = (optionId: string) => {
    onChange(optionId);
    setQuery("");
    setOpen(false);
  };

  // With no "none" row the options start at index 0; with one they start at 1
  // and index 0 IS that row.
  const offset = emptyLabel === undefined ? 0 : 1;
  const pickActive = () => {
    if (offset === 1 && active === 0) choose("");
    else if (shown[active - offset]) choose(shown[active - offset].id);
  };

  const box = compact
    ? "border border-line-strong bg-surface px-2 py-1.5 text-[13px]"
    : "border border-line-strong bg-surface px-3 py-2 text-sm";

  return (
    <div
      className={`relative ${className}`}
      onBlur={(e) => {
        // Closing on blur only when focus has actually left the control —
        // otherwise clicking an option closes the list before the click lands.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      {label && (
        <label
          htmlFor={id}
          className="block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1"
        >
          {label}
        </label>
      )}

      {/* What posts. The visible box is for finding a row; this carries the
          one that was found. */}
      {name && <input type="hidden" name={name} value={value} />}

      <input
        id={id}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={label ? undefined : placeholder}
        value={open ? query : (chosen?.label ?? "")}
        placeholder={chosen ? "" : placeholder}
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
            setActive((a) => Math.min(a + 1, rows - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open) {
            // Enter takes the highlighted row rather than submitting the form
            // around it — saving a voucher from a dropdown nobody meant to
            // confirm is how a half-filled one gets posted.
            e.preventDefault();
            pickActive();
          }
        }}
        className={`w-full outline-none focus:border-accent ${box}`}
      />

      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto border border-line-strong bg-surface shadow-lg"
        >
          {emptyLabel !== undefined && (
            <Option
              active={active === 0}
              onPick={() => choose("")}
              onHover={() => setActive(0)}
              text={emptyLabel}
              muted
            />
          )}
          {shown.map((o, i) => (
            <Option
              key={o.id}
              active={active === i + offset}
              onPick={() => choose(o.id)}
              onHover={() => setActive(i + offset)}
              text={o.label}
            />
          ))}
          {shown.length === 0 && query.trim() !== "" && (
            <li className="px-3 py-2 text-[13px] text-muted">
              Nothing matches “{query.trim()}”.
            </li>
          )}
          {limit !== undefined && !query.trim() && options.length > limit && (
            <li className="px-3 py-2 text-[12px] text-muted border-t border-line">
              {limit} of {options.length}. Type to search the rest.
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
