"use client";

import { useId, useRef, useState } from "react";

/**
 * A date input that reads and writes day/month/year.
 *
 * A native `<input type="date">` renders in the *browser's* locale, not the
 * page's, so on a machine set to US English every date in the app showed as
 * mm/dd/yyyy — and 03/04 is a different day depending on which half of that
 * the reader assumes. The page `lang` attribute does not override it in Chrome
 * or Firefox, so the only reliable fix is to render the text ourselves.
 *
 * What the merchant sees and types is `dd/mm/yyyy`. What the form submits is
 * still `YYYY-MM-DD`, from a hidden field carrying the original `name`, so
 * every server action and every GET query parameter parses exactly the string
 * it parsed before — this component changed no server code at all.
 *
 * The native picker is kept, opened by the calendar button through
 * `showPicker()`, because typing a full date is slower than tapping one on a
 * phone and the market is not a desk job.
 */
export function DateField({
  id,
  name,
  defaultValue = "",
  required = false,
  className = "",
  "aria-label": ariaLabel,
}: {
  id?: string;
  name: string;
  /** ISO `YYYY-MM-DD`, as every caller already has it. */
  defaultValue?: string;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const pickerRef = useRef<HTMLInputElement>(null);
  const [iso, setIso] = useState(defaultValue);
  const [text, setText] = useState(() => isoToDisplay(defaultValue));

  const malformed = text.trim() !== "" && iso === "";

  function onType(raw: string) {
    // Slashes are inserted as they type so the shape is obvious from the first
    // keystroke, and any other separator they reach for is accepted too.
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let next = digits;
    if (digits.length > 4)
      next = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2)
      next = `${digits.slice(0, 2)}/${digits.slice(2)}`;

    setText(next);
    setIso(displayToIso(next));
  }

  return (
    <div className="relative">
      <input
        id={inputId}
        aria-label={ariaLabel}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        required={required}
        value={text}
        onChange={(e) => onType(e.target.value)}
        aria-invalid={malformed || undefined}
        // pr-8 keeps the text clear of the calendar button sitting over the
        // right edge. Tailwind emits pr-* after px-*, so it wins against the
        // caller's own padding without them having to know this exists.
        className={`${className} pr-8 ${malformed ? "border-debit" : ""}`}
      />

      {/* Present in the DOM rather than display:none — showPicker() throws on a
          hidden input — but never focusable, so tabbing goes straight past it
          to the next real field. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={iso}
        onChange={(e) => {
          setIso(e.target.value);
          setText(isoToDisplay(e.target.value));
        }}
        className="absolute bottom-0 right-0 h-px w-px opacity-0 pointer-events-none"
      />

      <button
        type="button"
        onClick={() => pickerRef.current?.showPicker?.()}
        aria-label="Open calendar"
        title="Open calendar"
        className="absolute inset-y-0 right-0 px-2 text-muted hover:text-accent text-[13px]"
      >
        {/* Inline so the control carries no icon dependency. */}
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2" y="3" width="12" height="11" rx="1" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
      </button>

      {/* What actually posts. Unchanged format, unchanged field name. */}
      <input type="hidden" name={name} value={iso} />
    </div>
  );
}

/** `YYYY-MM-DD` → `dd/mm/yyyy`; anything else → "" so the field reads empty. */
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * `dd/mm/yyyy` → `YYYY-MM-DD`, or "" when it is not a real calendar day.
 *
 * The round-trip check is what rejects 31/02 — the Date constructor rolls that
 * forward to 3 March rather than failing, so comparing the parts back is the
 * only way to catch a day that does not exist.
 */
function displayToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display.trim());
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "";
  if (
    d.getUTCFullYear() !== Number(yyyy) ||
    d.getUTCMonth() + 1 !== Number(mm) ||
    d.getUTCDate() !== Number(dd)
  )
    return "";
  return `${yyyy}-${mm}-${dd}`;
}
