"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { PartyType, PurchaseType } from "@/generated/prisma/enums";
import { PARTY_TYPE_LABELS } from "@/lib/party";
import { quickCreateParty } from "./party-quick-create";

export type PartyOption = {
  id: string;
  name: string;
  type: PartyType;
  balance: number;
};

/**
 * Type-ahead picker over the party master, with inline creation.
 *
 * The value posted is the party *name*, matching how every voucher action
 * already resolves parties (find-or-create by name + type). That keeps this a
 * drop-in replacement for the plain text inputs it supersedes, and means a
 * name typed but never picked from the list still saves correctly — the list
 * is an aid, not a gate.
 *
 * Search runs against a Route Handler rather than a Server Action because Next
 * serialises Server Actions per client, which would queue keystrokes.
 * Requests are debounced and stale responses are discarded, so results can
 * never arrive out of order and overwrite newer ones.
 */
export function PartyCombobox({
  name,
  label,
  types,
  purchaseKind,
  expenseCategoryId,
  defaultValue = "",
  defaultType,
  typeFieldName,
  required = true,
  placeholder,
  onSelect,
  value,
  onValueChange,
  compact = false,
}: {
  /** Form field name carrying the chosen party name. */
  name: string;
  label: string;
  /** Party kinds to search within. */
  types: PartyType[];
  /**
   * Narrows PURCHASE_GROUP suggestions to the sellers of one purchase type, so
   * a Private bill does not offer KFDC and every local seller. Parties with no
   * kind on record still appear under all of them.
   */
  purchaseKind?: PurchaseType;
  /**
   * Puts vendors already paid under this expense head at the top of the list.
   * Narrows nothing — a new vendor is still findable and still creatable — it
   * just stops the ice plant being buried under every other expense vendor.
   */
  expenseCategoryId?: string;
  defaultValue?: string;
  /** Pre-selected party kind for a newly created party. */
  defaultType?: PartyType;
  /** When set, the chosen party's kind posts under this field name. */
  typeFieldName?: string;
  required?: boolean;
  placeholder?: string;
  onSelect?: (party: PartyOption | null) => void;
  /**
   * Controlled mode. Leave unset and the picker keeps its own text, which is
   * what a standalone field wants. Set it when the caller owns the value —
   * a repeating row, where deleting row 2 has to move row 3's name up with it
   * rather than leaving the text behind in a recycled component.
   */
  value?: string;
  onValueChange?: (value: string) => void;
  /**
   * Strip the label and the hint paragraph, for use inside a table cell where
   * the column header already says what the field is.
   */
  compact?: boolean;
}) {
  const listId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const controlled = value !== undefined;
  const query = controlled ? value : uncontrolled;
  const setQuery = (next: string) => {
    if (!controlled) setUncontrolled(next);
    onValueChange?.(next);
  };
  const [options, setOptions] = useState<PartyOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chosenType, setChosenType] = useState<PartyType>(
    defaultType ?? types[0]
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const [creating, startCreate] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

  // Callers pass `types` as an inline array literal, which is a new object on
  // every render. Depending on it directly would re-run this effect on each
  // render and loop forever, so the dependency is its stable string form.
  const typesKey = types.join(",");

  // Debounced search. `cancelled` guards against a slow early response
  // landing after a faster later one and showing stale results.
  useEffect(() => {
    let cancelled = false;
    // Loading is flagged when the request actually fires, not while the
    // debounce is still waiting — and setting it here rather than in the
    // effect body avoids a cascading render on every keystroke.
    const timer = setTimeout(async () => {
      if (!cancelled) setLoading(true);
      try {
        const params = new URLSearchParams({ q: query, types: typesKey });
        if (purchaseKind) params.set("purchaseKind", purchaseKind);
        if (expenseCategoryId) params.set("expenseCategory", expenseCategoryId);
        const res = await fetch(`/api/parties/search?${params}`);
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as { parties: PartyOption[] };
        if (!cancelled) setOptions(data.parties);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, typesKey, purchaseKind, expenseCategoryId]);

  // Close when focus leaves the whole control, not just the input, or clicking
  // an option would dismiss the list before the click registers.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const trimmed = query.trim();
  const exactExists = options.some(
    (o) => o.name.toLowerCase() === trimmed.toLowerCase()
  );
  const canCreate = trimmed.length > 0 && !exactExists && !loading;

  function choose(option: PartyOption) {
    setQuery(option.name);
    setChosenType(option.type);
    setOpen(false);
    onSelect?.(option);
  }

  /**
   * Write the typed name into the party master straight away, then treat it as
   * chosen.
   *
   * The button used to only close the dropdown and leave creation to save time,
   * which meant nothing existed for the *next* row to find: adding the same
   * boat on row 1 and row 2 of one bill offered "Add to master" both times.
   * Creating here is what makes the second row find it.
   *
   * The new party is selected with a zero balance rather than re-fetched: it
   * has no ledger entries by definition, so a round trip could only confirm
   * what is already known.
   */
  function createAndChoose() {
    const clean = trimmed;
    if (!clean || creating) return;
    setCreateError(null);
    startCreate(async () => {
      const res = await quickCreateParty(clean, chosenType, purchaseKind);
      if ("error" in res) {
        setCreateError(res.error);
        return;
      }
      choose({ ...res.party, balance: 0 });
    });
  }

  return (
    <div ref={boxRef} className="relative">
      {!compact && (
        <label
          htmlFor={listId}
          className="block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1"
        >
          {label}
        </label>
      )}
      <input
        id={listId}
        name={name}
        aria-label={compact ? label : undefined}
        value={query}
        required={required}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onSelect?.(null);
        }}
        onFocus={() => setOpen(true)}
        className={
          "w-full border border-line-strong bg-surface text-sm outline-none focus:border-accent " +
          (compact ? "px-2 py-1.5" : "px-3 py-2")
        }
      />
      {typeFieldName && (
        <input type="hidden" name={typeFieldName} value={chosenType} />
      )}

      {open && (
        <div className="absolute z-20 mt-1 w-full border border-line-strong bg-surface shadow-lg max-h-64 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => choose(o)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-background"
            >
              <span>
                <span className="font-medium">{o.name}</span>
                <span className="text-muted text-[12px]">
                  {" "}
                  · {PARTY_TYPE_LABELS[o.type]}
                </span>
              </span>
              {o.balance !== 0 && (
                <span
                  className={`num text-[12px] whitespace-nowrap ${
                    o.balance > 0 ? "text-debit" : "text-credit"
                  }`}
                >
                  {o.balance > 0 ? "owes " : "we owe "}
                  {Math.abs(o.balance).toLocaleString("en-IN")}
                </span>
              )}
            </button>
          ))}

          {canCreate && (
            <div className="border-t border-line">
              <button
                type="button"
                onClick={createAndChoose}
                disabled={creating}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-accent hover:bg-background disabled:opacity-60"
              >
                <span aria-hidden>＋</span>
                <span>
                  {creating
                    ? `Adding “${trimmed}”…`
                    : `Add “${trimmed}” to ${PARTY_TYPE_LABELS[chosenType]} master`}
                </span>
              </button>
              {createError && (
                <div className="px-3 pb-2 text-[12px] text-debit">
                  {createError}
                </div>
              )}
              {types.length > 1 && (
                <div className="px-3 pb-2 flex flex-wrap gap-1">
                  {types.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setChosenType(t)}
                      aria-pressed={t === chosenType}
                      className={
                        "border px-2 py-0.5 text-[11px] font-semibold " +
                        (t === chosenType
                          ? "bg-accent text-white border-accent"
                          : "border-line-strong bg-background hover:border-accent")
                      }
                    >
                      {PARTY_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!canCreate && options.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-muted">
              {loading ? "Searching…" : "No matches — keep typing to add a new one."}
            </div>
          )}
        </div>
      )}

      {!compact && (
        <p className="text-muted text-[12px] mt-1">
          A name that isn’t in the master yet is added automatically when the
          voucher is saved.
        </p>
      )}
    </div>
  );
}
