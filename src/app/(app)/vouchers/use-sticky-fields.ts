"use client";

import { useState } from "react";

/**
 * Keep what was typed when a save comes back with an error.
 *
 * React 19 RESETS an uncontrolled form once its action returns. That is right
 * for a save that succeeded and navigated away, and wrong for one that came
 * back saying "Boxes for BELT KANDI must be a positive whole number": the
 * merchant fixes the boxes and finds the bill number, the place and the notes
 * gone with them. On a voucher screen that is half a minute of retyping for
 * something they got right the first time.
 *
 * The fix is to make those fields CONTROLLED, since React only resets fields it
 * does not own. This does it in one line per field rather than a piece of state
 * each:
 *
 *     <input id="billNo" required {...field("billNo", initial?.billNo ?? "")} />
 *
 * The initial value is passed at the call site rather than up front, so it can
 * come from props, from `today`, or from anything else the component already
 * has — and it is used only until the field is first touched.
 *
 * Not needed for DateField or PartyCombobox: both already hold their own state
 * and so survive a reset on their own.
 */
export function useStickyFields() {
  const [typed, setTyped] = useState<Record<string, string>>({});

  function field(name: string, initial: string) {
    return {
      name,
      // Once touched, the typed value wins — including when it was cleared to
      // an empty string, which is why this is ?? and not ||.
      value: typed[name] ?? initial,
      onChange: (
        e: React.ChangeEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >
      ) => setTyped((t) => ({ ...t, [name]: e.target.value })),
    };
  }

  return { field };
}
