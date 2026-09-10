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

export type Range = { from: string; to: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The ranges a merchant actually asks for.
 *
 * Every list opened on the current month and offered nothing but two date
 * fields, so looking at last week meant typing two dates — every time, on every
 * screen. These are the four periods anybody names out loud.
 *
 * All of them are computed from businessToday(), never from `new Date()`: the
 * business day is decided on India time, and a server in another zone must not
 * decide that "today" is yesterday.
 */
export function monthRange(year: number, month1to12: number): Range {
  // Date.UTC with a 1-based month and day 0 lands on the last day of that month.
  const last = new Date(Date.UTC(year, month1to12, 0));
  return {
    from: `${year}-${String(month1to12).padStart(2, "0")}-01`,
    to: iso(last),
  };
}

/**
 * One single day, as a range whose ends are the same date.
 *
 * A merchant looking for one day's delivery notes was setting the exact-dates
 * form to "1 Sept 2026" twice — the same date typed into both boxes, every
 * time. The day is just the third field of a date, and the picker already asks
 * for the other two.
 *
 * Returns null for a day that month does not have, so 31 February falls back
 * to the whole month rather than producing a range nothing can be in.
 */
export function dayRange(
  year: number,
  month1to12: number,
  day: number
): Range | null {
  const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) return null;
  const iso1 = `${year}-${String(month1to12).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { from: iso1, to: iso1 };
}

export function yearRange(year: number): Range {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function todayRange(): Range {
  const t = businessToday();
  return { from: t, to: t };
}

/**
 * The calendar week containing today, Monday to Sunday.
 *
 * Monday rather than a rolling seven days: a merchant comparing "this week" to
 * "last week" wants two weeks that begin in the same place, and a rolling
 * window never gives them that.
 */
export function weekRange(): Range {
  const t = new Date(`${businessToday()}T00:00:00.000Z`);
  // getUTCDay: 0 is Sunday, so Sunday sits at the END of its week.
  const back = (t.getUTCDay() + 6) % 7;
  const monday = new Date(t);
  monday.setUTCDate(t.getUTCDate() - back);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

export function currentMonthRange(): Range {
  const [y, m] = businessToday().split("-").map(Number);
  return monthRange(y, m);
}

export type PresetKind = "today" | "week" | "month" | "year";

export function presetRange(kind: PresetKind): Range {
  const [y, m] = businessToday().split("-").map(Number);
  if (kind === "today") return todayRange();
  if (kind === "week") return weekRange();
  if (kind === "year") return yearRange(y);
  return monthRange(y, m);
}

/**
 * Which preset a window IS, if any — for showing which one is in force.
 *
 * Compared by the dates themselves rather than remembered in the URL, so a
 * hand-typed range that happens to be exactly this month still lights up "This
 * month", and a link shared between two people means the same thing to both.
 */
export function activePreset(w: { from: string; to: string }): PresetKind | null {
  for (const k of ["today", "week", "month", "year"] as const) {
    const r = presetRange(k);
    if (r.from === w.from && r.to === w.to) return k;
  }
  return null;
}

/**
 * Reads ?page/?from/?to off a list page's searchParams, falling back to page 1
 * of the current month. Anything malformed is ignored rather than rejected — a
 * hand-edited URL should show the default window, not an error page.
 */
export function parseListWindow(params: SearchParams): ListWindow {
  // Three ways to say the same thing, in the order they win:
  //
  //   ?from=&to=          an explicit range, including the preset links
  //   ?year=&month=&day=  the picker; each field narrows the one before it, so
  //                       ?year= alone is a whole year and adding a month or a
  //                       day closes it down without a range being typed
  //   nothing             this month, as it always was
  //
  // Each control submits only its own fields, so two of these can never arrive
  // together and disagree. Anything malformed falls through to the default
  // rather than erroring: a hand-edited URL should show a list, not a stack
  // trace.
  let base = currentMonthRange();

  const rawYear = Number(first(params.year));
  if (Number.isInteger(rawYear) && rawYear >= 2000 && rawYear <= 2100) {
    const rawMonth = Number(first(params.month));
    if (Number.isInteger(rawMonth) && rawMonth >= 1 && rawMonth <= 12) {
      // A day only means anything inside a month, and an impossible one falls
      // back to that month rather than to a range with nothing in it.
      const rawDay = Number(first(params.day));
      base =
        dayRange(rawYear, rawMonth, rawDay) ?? monthRange(rawYear, rawMonth);
    } else {
      base = yearRange(rawYear);
    }
  }

  const rawFrom = first(params.from);
  const rawTo = first(params.to);
  const from = rawFrom && DATE_RE.test(rawFrom) ? rawFrom : base.from;
  const to = rawTo && DATE_RE.test(rawTo) ? rawTo : base.to;

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

/**
 * The party a list is narrowed to, if any.
 *
 * Validated as a uuid rather than trusted: it goes straight into a `where`, and
 * an id that is not one should show the whole list rather than an error page —
 * the same rule the dates follow.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePartyFilter(params: SearchParams): string {
  const raw = first(params.party);
  return raw && UUID_RE.test(raw) ? raw : "";
}
