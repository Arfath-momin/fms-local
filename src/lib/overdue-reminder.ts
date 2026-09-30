export type OverdueReminder = {
  label: string;
  className: string;
  sortAge: number;
};

/** Build the dashboard label for a sale party's last receipt. */
export function overdueReminder(
  daysSinceActivity: number | null,
  activityDateLabel?: string,
  hasReceipt = true
): OverdueReminder {
  if (daysSinceActivity === null) {
    return {
      label: hasReceipt ? "Never paid" : "No sale activity",
      className: "border-debit bg-debit/10 text-debit",
      sortAge: Number.POSITIVE_INFINITY,
    };
  }

  if (daysSinceActivity >= 30) {
    return {
      label: activityDateLabel ? `Since ${activityDateLabel}` : `${daysSinceActivity} days ago`,
      className: "border-debit bg-debit/10 text-debit",
      sortAge: daysSinceActivity,
    };
  }
  if (daysSinceActivity >= 15) {
    return {
      label: `${daysSinceActivity} days ago`,
      className: "border-orange-500 bg-orange-500/10 text-orange-700",
      sortAge: daysSinceActivity,
    };
  }
  if (daysSinceActivity >= 7) {
    return {
      label: `${daysSinceActivity} days ago`,
      className: "border-amber-500 bg-amber-500/10 text-amber-700",
      sortAge: daysSinceActivity,
    };
  }
  return {
    label: `${daysSinceActivity} days ago`,
    className: "border-yellow-400 bg-yellow-400/10 text-yellow-700",
    sortAge: daysSinceActivity,
  };
}

/** Calendar-day difference for UTC-midnight @db.Date values. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}