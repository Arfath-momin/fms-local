"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * What a voucher does after a successful EDIT.
 *
 * It used to jump straight back to the voucher list. That is right after
 * entering a new one — the next thing a clerk does is enter another — and wrong
 * after fixing an old one, because fixing an old one starts somewhere else. A
 * merchant checking a month of ice against the plant's own statement works down
 * a filtered ledger, spots a rate typed wrong, opens the bill, corrects it, and
 * is then dropped on the list of every expense ever entered, with the month,
 * the head and the party all to pick out again. One correction, and the place
 * they were reading is gone.
 *
 * So an edit now stays put and says it saved, and Escape takes them back to
 * exactly the screen they came from — filters and all — because the edit added
 * no history entry to get lost in.
 *
 * The notice clears the moment anything is typed again: "Saved" over a form
 * that has since been changed is a claim about the wrong thing.
 */
export function useSaveNotice(state: { saved?: true } | null | undefined) {
  const router = useRouter();

  // Which result has been typed over. Held as the state OBJECT rather than a
  // boolean: every save returns a fresh one, so a second save is never
  // mistaken for the one already dismissed, and `showing` stays derived during
  // render instead of being set from an effect.
  const [dismissed, setDismissed] = useState<object | null>(null);

  useEffect(() => {
    if (!state?.saved) return;
    // The server component's props still hold the values from before this
    // save. Sticky fields keep the typed ones on screen, but every field that
    // is not sticky would fall back to a stale defaultValue — so a rate
    // corrected to 155 could redraw as the 151 that was just replaced.
    router.refresh();
  }, [state, router]);

  const showing = !!state?.saved && dismissed !== state;
  const clear = useCallback(() => setDismissed(state ?? null), [state]);
  return { showing, clear };
}

/** The confirmation itself, and what to press next. */
export function SavedNotice({ showing }: { showing: boolean }) {
  if (!showing) return null;
  return (
    <p
      role="status"
      className="text-credit text-[13px] border border-credit/40 bg-credit/5 px-3 py-2"
    >
      Saved. Press <kbd className="font-semibold">Esc</kbd> to go back to where
      you were.
    </p>
  );
}
