/**
 * What each key does — the whole map, in one pure list.
 *
 * ALT, not Ctrl, and the reason is worth recording. Browsers reserve Ctrl+N,
 * Ctrl+T, Ctrl+W and Ctrl+L outright — a page cannot intercept them — and
 * Ctrl+P, Ctrl+S, Ctrl+F and Ctrl+R can be captured only by hijacking print,
 * save, find and reload. Which rules out exactly the letters a vouchers app
 * wants: P for purchase and S for sale. Alt has none of those conflicts, so
 * every shortcut is the first letter of the thing it opens — and it is the
 * modifier a Tally user already has in their fingers.
 *
 * Deliberately NOT `server-only`: the help sheet renders this list and the
 * provider binds it, so both sides read one definition. A shortcut that works
 * and a shortcut that is documented must be the same shortcut.
 */
export type Shortcut = {
  /** As react-hotkeys-hook wants it. */
  combo: string;
  /** As a person reads it. */
  label: string;
  href: string;
  description: string;
};

export const SHORTCUTS: Shortcut[] = [
  { combo: "alt+v", label: "Alt+V", href: "/vouchers", description: "Vouchers" },
  { combo: "alt+p", label: "Alt+P", href: "/vouchers/purchases", description: "Purchases" },
  { combo: "alt+s", label: "Alt+S", href: "/vouchers/sales", description: "Sales" },
  { combo: "alt+d", label: "Alt+D", href: "/vouchers/deliveries", description: "Delivery notes" },
  { combo: "alt+e", label: "Alt+E", href: "/vouchers/expenses", description: "Expenses" },
  { combo: "alt+l", label: "Alt+L", href: "/ledgers", description: "Ledgers" },
  { combo: "alt+r", label: "Alt+R", href: "/reports", description: "Reports" },
  { combo: "alt+m", label: "Alt+M", href: "/masters", description: "Masters" },
];

/**
 * The lists that can raise a new voucher, so Alt+N knows where it is.
 *
 * Alt+N is the one shortcut whose meaning depends on the screen: on the Sales
 * list it raises a sale, on Purchases a purchase. A single fixed destination
 * would be wrong on every screen but one.
 */
const NEW_FROM: string[] = [
  "/vouchers/purchases",
  "/vouchers/sales",
  "/vouchers/deliveries",
  "/vouchers/expenses",
  "/vouchers/payments",
  "/vouchers/receipts",
  "/vouchers/crates",
];

/**
 * Where Alt+N goes from `pathname`, or null when nothing there can be raised.
 *
 * Matches the LIST itself and not its children: from /vouchers/sales/<id> the
 * merchant is reading one bill, and "new" there is more likely to be a slip
 * than an intention. Exported for its own test — this is the one shortcut with
 * a rule rather than a destination.
 */
export function newVoucherHref(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, "");
  return NEW_FROM.includes(clean) ? `${clean}/new` : null;
}
