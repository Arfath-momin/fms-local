"use client";

import { useEffect, useSyncExternalStore } from "react";

const PLAIN_CLASS = "print-plain";
const PLAIN_KEY = "fms_print_plain";

// A tiny store over localStorage rather than state seeded from an effect.
// The preference does not exist on the server, so it has to be read after
// mount; useSyncExternalStore is how React does that without a setState during
// an effect and without a hydration mismatch on the first paint.
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  // Another tab changing the preference should not leave this one disagreeing.
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

const getSnapshot = () => localStorage.getItem(PLAIN_KEY) === "1";
/** The server has no localStorage; colour is the default until proven otherwise. */
const getServerSnapshot = () => false;

function setPlain(next: boolean) {
  localStorage.setItem(PLAIN_KEY, next ? "1" : "0");
  for (const fn of listeners) fn();
}

/**
 * The on-screen controls above a printable voucher — never printed themselves.
 *
 * "Print / Save as PDF" is one button because the browser's print dialog is
 * also where Save as PDF lives, so printing a bill and producing a file to send
 * are the same action.
 *
 * The plain toggle exists because colour on paper is a running cost. A merchant
 * printing fifty delivery notes a day should be able to turn the band and the
 * row tint off once and have it stay off, so the choice is remembered rather
 * than re-made on every note.
 */
export function PrintToolbar({
  backHref,
  backLabel,
}: {
  backHref: string;
  backLabel: string;
}) {
  const plain = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  // The class goes on <body> so it reaches the sheet and the print stylesheet
  // alike; the sheet itself is server-rendered and has no state of its own.
  useEffect(() => {
    document.body.classList.toggle(PLAIN_CLASS, plain);
    return () => document.body.classList.remove(PLAIN_CLASS);
  }, [plain]);

  return (
    <div className="no-print flex items-center justify-between gap-4 mb-4 flex-wrap">
      <a
        href={backHref}
        className="text-muted text-[13px] underline underline-offset-2"
      >
        ← {backLabel}
      </a>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          <input
            type="checkbox"
            checked={plain}
            onChange={(e) => setPlain(e.target.checked)}
          />
          Plain (no colour)
        </label>
        <button
          type="button"
          onClick={() => window.print()}
          className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
        >
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}
