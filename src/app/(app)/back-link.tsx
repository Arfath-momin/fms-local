"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * "← Purchases" — one back link, rendered once, on every screen that has
 * somewhere to go back to.
 *
 * A dozen pages had hand-written back links and thirty-one had none, so getting
 * out of an expense voucher meant reaching for the browser button while getting
 * out of a delivery note did not. Rather than add thirty-one more copies to
 * drift apart, the link is derived from the URL in the layout: every page gets
 * one automatically, and a page added tomorrow gets one without anybody
 * remembering to.
 *
 * The destination is the path with its last segment removed, which is the
 * parent in every case because the routes are already nested the way the
 * merchant navigates them. It is a real href, not history.back(): a link opened
 * from a message or a bookmark has no history to go back to, and a back button
 * that does nothing is worse than none.
 *
 * Top-level sections render nothing — there is no "up" from Vouchers.
 */

/** Sections with nothing above them. */
const TOP_LEVEL = new Set([
  "/dashboard",
  "/vouchers",
  "/ledgers",
  "/masters",
  "/reports",
  "/union",
]);

/**
 * What each path segment is called, and what ONE of it is called.
 *
 * The singular matters for edit screens: the parent of
 * /vouchers/sales/<id>/edit is the sale itself, so the link has to read
 * "← Sale", not "← Sales".
 */
const NAMES: Record<string, { plural: string; singular: string }> = {
  vouchers: { plural: "Vouchers", singular: "Voucher" },
  purchases: { plural: "Purchases", singular: "Purchase" },
  sales: { plural: "Sales", singular: "Sale" },
  deliveries: { plural: "Delivery Notes", singular: "Delivery Note" },
  expenses: { plural: "Expenses", singular: "Expense" },
  payments: { plural: "Payments", singular: "Payment" },
  receipts: { plural: "Receipts", singular: "Receipt" },
  crates: { plural: "Crates", singular: "Crate Entry" },
  "reserve-collections": {
    plural: "Reserve Collections",
    singular: "Reserve Collection",
  },
  ledgers: { plural: "Ledgers", singular: "Ledger" },
  parties: { plural: "Parties", singular: "Party" },
  "purchase-parties": {
    plural: "Purchase Parties",
    singular: "Purchase Party",
  },
  "day-book": { plural: "Day Book", singular: "Day Book" },
  boxes: { plural: "Boxes by Trip", singular: "Boxes by Trip" },
  outstanding: { plural: "Outstanding", singular: "Outstanding" },
  reserve: { plural: "Reserve", singular: "Reserve" },
  masters: { plural: "Masters", singular: "Master" },
  centres: { plural: "Centres", singular: "Centre" },
  vehicles: { plural: "Vehicles", singular: "Vehicle" },
  "expense-categories": {
    plural: "Expense Categories",
    singular: "Expense Category",
  },
  reports: { plural: "Reports", singular: "Report" },
  profit: { plural: "Profit & Loss", singular: "Profit & Loss" },
  register: { plural: "Transactions", singular: "Transactions" },
  companies: { plural: "Companies", singular: "Company" },
  users: { plural: "Users", singular: "User" },
  dashboard: { plural: "Dashboard", singular: "Dashboard" },
};

/** A uuid or a document code standing in for one record. */
const isRecordId = (seg: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg);

function label(segments: string[]): string {
  const last = segments[segments.length - 1];
  if (!last) return "Dashboard";

  // The parent is a single record — /vouchers/sales/<id>. Name it after what
  // kind of record it is, in the singular.
  if (isRecordId(last)) {
    const owner = segments[segments.length - 2];
    return NAMES[owner]?.singular ?? "Back";
  }

  // An expense head is reached by its CODE, not an id: /ledgers/expenses/RENT.
  // Upper-case segments are that, and the code itself is the best name for it.
  if (/^[A-Z][A-Z_]*$/.test(last)) return last.replace(/_/g, " ");

  return NAMES[last]?.plural ?? "Back";
}

/**
 * Screens that render their own back link because the URL cannot say where
 * back is. Just one: a party statement lives at /ledgers/parties/<id> whichever
 * section it was opened from, and only the party's TYPE decides whether the way
 * back is Purchase Parties or Parties.
 */
const SELF_MANAGED = /^\/ledgers\/parties\/[^/]+$/;

export function BackLink() {
  const pathname = usePathname();
  if (!pathname || TOP_LEVEL.has(pathname)) return null;
  if (SELF_MANAGED.test(pathname)) return null;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const parentSegments = segments.slice(0, -1);
  let href = "/" + parentSegments.join("/");

  // /admin is a grouping, not a screen — there is no page at it, so the way
  // back from Users and Companies is the dashboard.
  if (href === "/admin") return <Back href="/dashboard" text="Dashboard" />;

  // A "new" or "edit" screen reached directly under a section behaves the same
  // as any other child; nothing special is needed for them beyond the label.
  if (href === "") href = "/dashboard";

  return <Back href={href} text={label(parentSegments)} />;
}

function Back({ href, text }: { href: string; text: string }) {
  return (
    <Link
      href={href}
      className="text-muted text-[12px] underline underline-offset-2 inline-block mb-1"
    >
      ← {text}
    </Link>
  );
}
