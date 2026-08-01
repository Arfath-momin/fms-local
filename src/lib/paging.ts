import "server-only";
import { businessToday } from "@/lib/format";

/**
 * Date windowing and paging for the voucher and ledger lists.
 *
 * Before this, every list page ran an unbounded findMany: the whole table, every
 * time, growing linearly forever. A bounded date range plus a page size keeps
 * those queries flat no matter how many years of entries accumulate, and it maps
 * exactly onto the indexes the schema already declares —
 * @@index([companyId, centreId, date]) — so Postgres can satisfy a page from the
 * index rather than scanning.
 *
 * Dates here are the same shape the vouchers use: "YYYY-MM-DD" strings in the
 * URL, and UTC-midnight Dates for the query, because @db.Date columns store UTC
 * midnight. Everything routes through businessToday() so the default window
 * follows the India business day rather than the server's UTC clock.
 */

export const PAGE_SIZE = 50;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type SearchParams = Record<string, string | string[] | undefined>;

export type ListWindow = {
  /** 1-based, for display and for building links. */
  page: number;
  skip: number;
  take: number;
  /** Inclusive bounds, "YYYY-MM-DD", for <input type="date"> and links. */
  from: string;
  to: string;
  /** The same bounds as UTC-midnight Dates, for `gte`/`lte` on a @db.Date. */
  fromDate: Date;
  toDate: Date;
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** The current India-time calendar month, as inclusive "YYYY-MM-DD" bounds. */
function currentMonth(): { from: string; to: string } {
  const [y, m] = businessToday().split("-").map(Number);
  // Date.UTC with a 1-based month and day 0 lands on the last day of that month.
  const last = new Date(Date.UTC(y, m, 0));
  return {
    from: `${y}-${String(m).padStart(2, "0")}-01`,
    to: last.toISOString().slice(0, 10),
  };
}

/**
 * Reads ?page/?from/?to off a list page's searchParams, falling back to page 1
 * of the current month. Anything malformed is ignored rather than rejected — a
 * hand-edited URL should show the default window, not an error page.
 */
export function parseListWindow(params: SearchParams): ListWindow {
  const month = currentMonth();

  const rawFrom = first(params.from);
  const rawTo = first(params.to);
  const from = rawFrom && DATE_RE.test(rawFrom) ? rawFrom : month.from;
  const to = rawTo && DATE_RE.test(rawTo) ? rawTo : month.to;

  const rawPage = Number(first(params.page));
  const page =
    Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1;

  return {
    page,
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    from,
    to,
    fromDate: new Date(`${from}T00:00:00.000Z`),
    toDate: new Date(`${to}T00:00:00.000Z`),
  };
}

/** `where` fragment for the date column, to spread into a Prisma query. */
export function dateWhere(w: ListWindow) {
  return { date: { gte: w.fromDate, lte: w.toDate } };
}

/** Builds a link back to the same list with one part of the window changed. */
export function listHref(
  basePath: string,
  w: ListWindow,
  overrides: { page?: number } = {}
): string {
  const q = new URLSearchParams({
    from: w.from,
    to: w.to,
    page: String(overrides.page ?? w.page),
  });
  return `${basePath}?${q.toString()}`;
}
