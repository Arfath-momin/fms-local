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
      className: "border-red-200 bg-red-50 text-red-700",
      sortAge: Number.POSITIVE_INFINITY,
    };
  }

  if (daysSinceActivity >= 30) {
    return {
      label: activityDateLabel ? `Since ${activityDateLabel}` : `${daysSinceActivity} days ago`,
      className: "border-red-200 bg-red-50 text-red-700",
      sortAge: daysSinceActivity,
    };
  }
  if (daysSinceActivity >= 15) {
    return {
      label: `${daysSinceActivity} days ago`,
      className: "border-orange-200 bg-orange-50 text-orange-700",
      sortAge: daysSinceActivity,
    };
  }
  if (daysSinceActivity >= 7) {
    return {
      label: `${daysSinceActivity} days ago`,
      className: "border-amber-200 bg-amber-50 text-amber-700",
      sortAge: daysSinceActivity,
    };
  }
  return {
    label: `${daysSinceActivity} days ago`,
    className: "border-yellow-200 bg-yellow-50 text-yellow-700",
    sortAge: daysSinceActivity,
  };
}

/** Calendar-day difference for UTC-midnight @db.Date values. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}