import type { ReviewLinkedType } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Review requests — the accountant's only route to a correction.
//
// An accountant enters vouchers but may never edit one (see src/lib/session.ts).
// Rather than loosen that, a mistake is raised as a request against the voucher
// and the admin makes the change.
//
// This half is the vocabulary — labels, routes, limits — and stays free of
// Prisma so the request form can import it. Everything that touches the
// database lives in review-db.ts, the same split as party.ts / party-db.ts.
// ---------------------------------------------------------------------------

export const REVIEW_TYPE_LABELS: Record<ReviewLinkedType, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
  DELIVERY_NOTE: "Delivery Note",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
};

/** The list route each voucher type lives under. */
const REVIEW_TYPE_BASE: Record<ReviewLinkedType, string> = {
  PURCHASE: "/vouchers/purchases",
  SALE: "/vouchers/sales",
  EXPENSE: "/vouchers/expenses",
  DELIVERY_NOTE: "/vouchers/deliveries",
  PAYMENT: "/vouchers/payments",
  RECEIPT: "/vouchers/receipts",
};

export const reviewVoucherPath = (
  linkedType: ReviewLinkedType,
  linkedId: string
): string => `${REVIEW_TYPE_BASE[linkedType]}/${linkedId}`;

/**
 * The longest reason we store — long enough to describe a fix, short enough to
 * read at a glance on the dashboard. Enforced on the form and again in the
 * action, since the form is not a security boundary.
 */
export const REVIEW_REASON_MAX = 500;
