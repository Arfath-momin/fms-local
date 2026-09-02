"use client";

import { SHORTCUTS } from "@/lib/shortcuts";
import { useEscapeLayer } from "./escape-layer";

/**
 * The sheet that says what the keys do, on `?`.
 *
 * Built from the same list the provider binds, so a shortcut that works and a
 * shortcut that is documented are the same shortcut. A printed card on the wall
 * goes stale the first time a binding changes; this cannot.
 */
export function ShortcutHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Escape closes this before it closes anything else, like any other overlay.
  useEscapeLayer(open, onClose);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md border border-line-strong bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="heading text-[15px] font-semibold">Keyboard</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted text-[12px] underline underline-offset-2"
          >
            close
          </button>
        </div>

        <dl className="text-[13px]">
          {SHORTCUTS.map((s) => (
            <Row key={s.combo} keys={s.label} what={s.description} />
          ))}
          <Row keys="Alt+N" what="New, on a list that can raise one" />
          <Row keys="Esc" what="Close, then leave the field, then go back" />
          <Row keys="?" what="This sheet" />
        </dl>

        <p className="text-muted text-[12px] mt-3">
          Alt rather than Ctrl: the browser keeps Ctrl+P for printing and Ctrl+S
          for saving, which are the two letters a vouchers screen wants most.
        </p>
      </div>
    </div>
  );
}

function Row({ keys, what }: { keys: string; what: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 border-b border-line last:border-0">
      <dt className="font-semibold num whitespace-nowrap">{keys}</dt>
      <dd className="text-muted text-right">{what}</dd>
    </div>
  );
}
