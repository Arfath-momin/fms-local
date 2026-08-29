import Link from "next/link";

/**
 * Two questions about boxes, kept apart.
 *
 *   Crates held   what each market is still holding in empty boxes, counted by
 *                 hand, across every trip. A debt in wood.
 *   Boxes by trip where the boxes of FISH on one load ended up, derived from
 *                 the bills.
 *
 * They were one screen for a while and it read as a contradiction: the same
 * word counting two different things, one of which balances to nothing per trip
 * and one of which is meant to carry forward.
 */
export function BoxTabs({ active }: { active: "crates" | "trips" }) {
  const tabs = [
    { key: "crates", href: "/ledgers/crates", label: "Crates held" },
    { key: "trips", href: "/ledgers/boxes", label: "Boxes by trip" },
  ] as const;

  return (
    <div className="flex gap-2 mb-4">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={
            "border px-3 py-1.5 text-[13px] font-semibold " +
            (t.key === active
              ? "border-accent text-accent"
              : "border-line-strong hover:border-accent")
          }
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
