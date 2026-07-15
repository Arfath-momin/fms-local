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

/** Prisma Decimal (or anything numeric-ish) → "₹1,23,456.00" */
export function fmtMoney(value: unknown): string {
  return inr.format(Number(value));
}

/** Prisma Decimal (or anything numeric-ish) → "1,234.5 kg" */
export function fmtKg(value: unknown): string {
  return `${kg.format(Number(value))} kg`;
}

/** Date → "15 Jul 2026" */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC", // @db.Date values are UTC midnight
  });
}

/** Date → "2026-07-15" for <input type="date"> */
export function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
