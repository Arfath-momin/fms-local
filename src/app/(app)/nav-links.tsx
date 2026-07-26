"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";

// `roles: undefined` means every signed-in role sees it. Auditors get no
// Vouchers or Masters entry — they read ledgers and reports, and reach an
// individual voucher only by drilling down from one of those.
const LINKS: { href: string; label: string; roles?: Role[] }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/vouchers", label: "Vouchers", roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/masters", label: "Masters", roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/ledgers", label: "Ledgers" },
  { href: "/reports", label: "Reports" },
  { href: "/union", label: "Union" },
  { href: "/admin/users", label: "Users", roles: ["ADMIN"] },
];

export function NavLinks({ role }: { role: Role }) {
  const pathname = usePathname();
  const visible = LINKS.filter((l) => !l.roles || l.roles.includes(role));

  return (
    <nav className="py-2">
      {visible.map((l) => {
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
