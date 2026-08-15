import { businessToday, fmtDate, toInputDate } from "@/lib/format";

/**
 * The period selection behind the Transactions Report and its CSV export.
 *
 * Both read the same query string and must resolve it identically — an export
 * that covered a different window from the screen it was taken off would be
 * worse than no export. They share this module rather than each parsing the
 * params themselves, which is how they drifted apart before.
 *
 *   day     one calendar date, every individual transaction
 *   month   one row per day of that month
 *   year    one row per month of that year
 *   range   an arbitrary from/to, every individual transaction
 */
export type RegisterView = "day" | "month" | "year" | "range";

export const REGISTER_VIEWS: { id: RegisterView; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "range", label: "Range" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

/**
 * The widest range the transaction list will draw. The query itself is indexed
 * on (company_id, centre_id, date) and would happily return ten years; the
 * limit is the page, which renders every row. A year is past anything anyone
 * reads transaction by transaction — the Month and Year views exist for that.
 */
export const MAX_RANGE_DAYS = 366;

/** Rows drawn before the list stops and asks for a narrower range. */
export const MAX_RANGE_ROWS = 500;

const DAY_MS = 24 * 60 * 60 * 1000;
const isDay = (v: string | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export type RegisterParams = {
  view?: string;
  period?: string;
  from?: string;
  to?: string;
  scope?: string;
};

export type RegisterPeriod = {
  view: RegisterView;
  /** Anchor for day/month/year; empty for a range, which uses from/to. */
  period: string;
  from: Date;
  to: Date;
  label: string;
  /** True when the requested range was longer than MAX_RANGE_DAYS. */
  clamped: boolean;
};

export function parseRegisterPeriod(sp: RegisterParams): RegisterPeriod {
  const view: RegisterView =
    sp.view === "month" || sp.view === "year" || sp.view === "range"
      ? sp.view
      : "day"; // Day is the default: opening the report should answer "what
  // happened today", not present a grid that has to be drilled into.
  const today = businessToday(); // "YYYY-MM-DD" in IST

  if (view === "range") {
    // A week ending today is the useful default — the case this view exists
    // for is "show me the last few days", not "show me one date".
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    let from = isDay(sp.from)
      ? new Date(`${sp.from}T00:00:00.000Z`)
      : new Date(todayDate.getTime() - 6 * DAY_MS);
    let to = isDay(sp.to) ? new Date(`${sp.to}T00:00:00.000Z`) : todayDate;

    // A backwards range is a slip, not an error worth refusing — read it the
    // way it was obviously meant.
    if (from.getTime() > to.getTime()) [from, to] = [to, from];

    const span = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
    const clamped = span > MAX_RANGE_DAYS;
    if (clamped) from = new Date(to.getTime() - (MAX_RANGE_DAYS - 1) * DAY_MS);

    return {
      view,
      period: "",
      from,
      to,
      label: `${fmtDate(from)} → ${fmtDate(to)}`,
      clamped,
    };
  }

  if (view === "day") {
    const period = isDay(sp.period) ? sp.period : today;
    const d = new Date(`${period}T00:00:00.000Z`);
    return { view, period, from: d, to: d, label: fmtDate(d), clamped: false };
  }

  if (view === "year") {
    const period = /^\d{4}$/.test(sp.period ?? "") ? sp.period! : today.slice(0, 4);
    const y = Number(period);
    return {
      view,
      period,
      from: new Date(Date.UTC(y, 0, 1)),
      to: new Date(Date.UTC(y, 11, 31)),
      label: period,
      clamped: false,
    };
  }

  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "")
    ? sp.period!
    : today.slice(0, 7);
  const [y, m] = period.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last of this
  return {
    view,
    period,
    from,
    to,
    label: from.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    clamped: false,
  };
}

/**
 * The same instant re-expressed for another view, so switching tabs keeps
 * place.
 *
 * Narrowing needs an anchor *inside* the range, and the start of it is a poor
 * guess: switching from August to Day landed on the 1st, which for most of the
 * month is a day with no trade — the report looked broken when it was merely
 * pointed at an empty date. Today is the useful answer whenever the range
 * contains it; otherwise fall back to where the range starts.
 */
export function periodFor(view: RegisterView, from: Date, to: Date): string {
  const today = businessToday();
  const inRange = today >= toInputDate(from) && today <= toInputDate(to);
  const anchor = inRange ? today : toInputDate(from);
  return view === "day"
    ? anchor
    : view === "month"
      ? anchor.slice(0, 7)
      : view === "year"
        ? anchor.slice(0, 4)
        : anchor;
}

/** The report URL for a view, carrying whichever period fields it needs. */
export function registerHref(
  view: RegisterView,
  p: { period: string; from: Date; to: Date; scope: string }
): string {
  const params = new URLSearchParams({ view, scope: p.scope });
  if (view === "range") {
    params.set("from", toInputDate(p.from));
    params.set("to", toInputDate(p.to));
  } else {
    params.set("period", p.period || periodFor(view, p.from, p.to));
  }
  return `/reports/register?${params}`;
}
