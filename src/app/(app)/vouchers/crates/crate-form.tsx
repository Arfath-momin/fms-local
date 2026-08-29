"use client";

import { useActionState, useState } from "react";
import type { CrateFormState } from "./actions";
import { businessToday } from "@/lib/format";
import type { FormScope } from "@/lib/scope";
import type { TripOption } from "@/lib/trip";
import { PartyCombobox } from "../../masters/party-combobox";
import { ScopeFields } from "../scope-fields";
import { DateField } from "../../date-field";

const inputCls =
  "w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const labelCls =
  "block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1";

/** What each market is already holding, so the form shows it before you type. */
export type CrateHolding = { partyId: string; partyName: string; holding: number };

/**
 * One line of the crate account: what went out to a market, what came back.
 *
 * Entered by hand, against a trip. The bills know how many boxes of fish were
 * dropped and the count is offered from them — but it is offered, not imposed.
 * A crate can go out broken, come back on a different trip from the one it left
 * on, or never come back at all, and none of that reaches a bill. What is
 * stored is the count somebody made on the ground.
 */
export function CrateEntryForm({
  action,
  holdings,
  trips,
  billedBoxes,
  scope,
}: {
  action: (
    prev: CrateFormState,
    formData: FormData
  ) => Promise<CrateFormState>;
  holdings: CrateHolding[];
  trips: TripOption[];
  /** `${tripId}|${partyName-lowercased}` → boxes that trip's bills gave them. */
  billedBoxes: Record<string, number>;
  scope: FormScope;
}) {
  const [state, formAction, pending] = useActionState<CrateFormState, FormData>(
    action,
    null
  );
  const [partyName, setPartyName] = useState("");
  const [tripId, setTripId] = useState("");
  const [date, setDate] = useState(businessToday());
  const [boxesOut, setBoxesOut] = useState("");
  const [boxesReturned, setBoxesReturned] = useState("");

  const held =
    holdings.find(
      (h) => h.partyName.toLowerCase() === partyName.trim().toLowerCase()
    )?.holding ?? 0;

  const suggestion =
    tripId && partyName.trim()
      ? billedBoxes[`${tripId}|${partyName.trim().toLowerCase()}`]
      : undefined;

  /**
   * Picking a trip dates the row to that trip's BUYING day.
   *
   * Not to today. Crates that went out on Tuesday's load belong to Tuesday
   * however long the paperwork takes to catch up (invariant 1).
   */
  function applyTrip(id: string) {
    setTripId(id);
    const t = trips.find((x) => x.id === id);
    if (t) setDate(t.date);
  }

  const n = (v: string) => Number(v) || 0;
  const closing = held + n(boxesOut) - n(boxesReturned);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <ScopeFields scope={scope} />

      <div>
        <PartyCombobox
          name="partyName"
          label="Market party"
          types={["MARKET_BUYER"]}
          value={partyName}
          onValueChange={setPartyName}
          placeholder="Which market"
        />
        {partyName.trim() !== "" && (
          <p className="text-muted text-[12px] mt-1">
            {held > 0
              ? `Currently holding ${held} crate${held === 1 ? "" : "s"}.`
              : "No crates recorded against this market yet."}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="deliveryNoteId" className={labelCls}>
          Trip (optional)
        </label>
        <select
          id="deliveryNoteId"
          name="deliveryNoteId"
          value={tripId}
          onChange={(e) => applyTrip(e.target.value)}
          className={inputCls}
        >
          <option value="">No trip — an opening balance</option>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.date} · {t.billNo} · {t.vehicleNumber}
            </option>
          ))}
        </select>
        <p className="text-muted text-[12px] mt-1">
          The trip supplies the buying day, the vehicle and the line man. Leave
          it empty to record what a market was already holding when the books
          opened.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="date" className={labelCls}>
            Date
          </label>
          {/* Remounted when the trip changes, because DateField is
              uncontrolled — the same trick the expense form uses to let a
              picked trip overwrite a date the clerk may already have set. */}
          <DateField
            key={date}
            id="date"
            name="date"
            required
            defaultValue={date}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="place" className={labelCls}>
            Place
          </label>
          <input id="place" name="place" className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="boxesOut" className={labelCls}>
            Crates sent
          </label>
          <input
            id="boxesOut"
            name="boxesOut"
            inputMode="numeric"
            value={boxesOut}
            onChange={(e) => setBoxesOut(e.target.value)}
            className={inputCls + " num text-right"}
            placeholder="0"
          />
          {suggestion !== undefined && suggestion > 0 && (
            <p className="text-muted text-[12px] mt-1">
              This market&rsquo;s bills off that trip come to{" "}
              <button
                type="button"
                onClick={() => setBoxesOut(String(suggestion))}
                className="text-accent underline underline-offset-2"
              >
                {suggestion} crates
              </button>
              . Use it or type the count you made.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="boxesReturned" className={labelCls}>
            Crates returned
          </label>
          <input
            id="boxesReturned"
            name="boxesReturned"
            inputMode="numeric"
            value={boxesReturned}
            onChange={(e) => setBoxesReturned(e.target.value)}
            className={inputCls + " num text-right"}
            placeholder="0"
          />
          <p className="text-muted text-[12px] mt-1">
            Empty crates handed back — not fish they rejected.
          </p>
        </div>
      </div>

      {/* The arithmetic, spelled out. A crate account is a running count and
          the only figure that matters is where it lands. */}
      {partyName.trim() !== "" && (n(boxesOut) > 0 || n(boxesReturned) > 0) && (
        <div className="border border-line-strong bg-surface px-4 py-3 text-[13px]">
          <Row label="Already holding" value={held} />
          {n(boxesOut) > 0 && <Row label="Sent" value={n(boxesOut)} />}
          {n(boxesReturned) > 0 && (
            <Row label="Returned" value={-n(boxesReturned)} />
          )}
          <div className="flex justify-between border-t border-line-strong mt-1 pt-1 font-semibold">
            <span>Will be holding</span>
            <span className={"num " + (closing < 0 ? "text-debit" : "")}>
              {closing}
            </span>
          </div>
          {closing < 0 && (
            <p className="text-debit text-[12px] mt-1">
              That returns more crates than this market ever received. It saves,
              because the count on the ground wins — but it usually means an
              earlier trip was never entered.
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="notes" className={labelCls}>
          Notes (optional)
        </label>
        <input id="notes" name="notes" className={inputCls} />
      </div>

      {state?.error && <p className="text-debit text-[13px]">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-white px-5 py-2 text-[13px] font-semibold disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
