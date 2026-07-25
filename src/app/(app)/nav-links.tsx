"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/vouchers", label: "Vouchers" },
  { href: "/masters", label: "Masters" },
  { href: "/ledgers", label: "Ledgers" },
  { href: "/reports", label: "Reports" },
  { href: "/union", label: "Union" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="py-2">
      {LINKS.map((l) => {
        const active =
          pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              "block px-4 py-2 text-[13px] tracking-wide border-l-2 " +
              (active
                ? "border-company bg-white/10 text-white font-semibold"
                : "border-transparent text-sidebar-ink/80 hover:text-white hover:bg-white/5")
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
