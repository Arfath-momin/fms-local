import Link from "next/link";

// Error-flagged rows: unmistakable but unobtrusive (design doc #8).
export function CorrectedBadge({
  href,
}: {
  href: string | null;
}) {
  const badge = (
    <span className="ml-2 text-[10px] uppercase tracking-wide border border-debit text-debit px-1.5 py-0.5 font-semibold">
      corrected
    </span>
  );
  return href ? <Link href={href}>{badge}</Link> : badge;
}

// Closed days look distinct in list views (design doc #9).
export function LockMark({ closed }: { closed: boolean }) {
  if (!closed) return null;
  return (
    <span
      title="Day closed — entries are final"
      aria-label="Day closed"
      className="ml-1.5 text-[11px] opacity-60 select-none"
    >
      🔒
    </span>
  );
}
