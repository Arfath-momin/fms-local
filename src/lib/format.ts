/**
 * The business runs on India time. Every "what is today" decision in the app
 * must go through businessToday()/businessTodayDate() — never `new Date()` and
 * never `toISOString()`, both of which answer in UTC and are therefore a day
 * behind between midnight and 05:30 IST, exactly when the market is busiest.
 */
export const BUSINESS_TIMEZONE = "Asia/Kolkata";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const kg = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const businessDayParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: BUSINESS_TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Prisma Decimal (or anything numeric-ish) → "₹1,23,456.00" */
export function fmtMoney(value: unknown): string {
  return inr.format(Number(value));
}

/** Prisma Decimal (or anything numeric-ish) → "1,234.5 kg" */
export function fmtKg(value: unknown): string {
  return `${kg.format(Number(value))} kg`;
}

/** A stored @db.Date → "15 Jul 2026" */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC", // @db.Date values are UTC midnight
  });
}

/** A real timestamp (createdAt, updatedAt) → "15 Jul 2026, 04:35 am" in IST */
export function fmtDateTime(d: Date): string {
  return dateTime.format(d);
}

/**
 * A stored @db.Date → "2026-07-15" for <input type="date">.
 *
 * Only for values that came out of a @db.Date column — those are UTC midnight,
 * so reading them back in UTC is what preserves the calendar day. For "today",
 * use businessToday() instead.
 */
export function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Today's calendar date in India, as "YYYY-MM-DD". Safe in both server and
 * client components. Assembled from parts so the locale cannot reorder it.
 */
export function businessToday(now: Date = new Date()): string {
  const parts = businessDayParts.formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Today in India as a UTC-midnight Date, so it compares directly against values
 * read from @db.Date columns.
 */
export function businessTodayDate(now: Date = new Date()): Date {
  return new Date(`${businessToday(now)}T00:00:00.000Z`);
}
