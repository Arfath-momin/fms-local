"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";

// `roles: undefined` means every signed-in role sees it. Auditors get no
// Vouchers or Masters entry — they read ledgers and reports, and reach an
// individual voucher only by drilling down from one of those. Accountants get
// no analytics (Dashboard / Reports / Union) but keep Ledgers, which they need
// to record payments and receipts against the right balance.
//
// This list only hides links; the pages enforce the same rule server-side via
// requireReports(), so a typed URL cannot get past it.
const LINKS: { href: string; label: string; roles?: Role[] }[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["ADMIN", "AUDITOR"] },
  { href: "/vouchers", label: "Vouchers", roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/masters", label: "Masters", roles: ["ADMIN", "ACCOUNTANT"] },
  { href: "/ledgers", label: "Ledgers" },
  { href: "/reports", label: "Reports", roles: ["ADMIN", "AUDITOR"] },
  { href: "/union", label: "Union", roles: ["ADMIN", "AUDITOR"] },
  // Users and Companies are both super admin only, and deliberately listed as
  // SUPER_ADMIN rather than ADMIN so the superset rule below does NOT apply.
  // A company is the boundary every other permission is expressed against, so
  // the people it exists to separate must not be able to add one — and for the
  // same reason they must not be able to hand out accounts or company grants.
  { href: "/admin/users", label: "Users", roles: ["SUPER_ADMIN"] },
  { href: "/admin/companies", label: "Companies", roles: ["SUPER_ADMIN"] },
];

/**
 * SUPER_ADMIN is a strict superset of ADMIN, so it matches anywhere ADMIN does
 * rather than being listed on every row above. Spelling it out per link would
 * mean one forgotten entry hides a whole section from the system owner — and a
 * role that sees no links at all has no way back except a typed URL.
 */
const canSee = (roles: Role[] | undefined, role: Role): boolean =>
  !roles ||
  roles.includes(role) ||
  (role === "SUPER_ADMIN" && roles.includes("ADMIN"));

export function NavLinks({ role }: { role: Role }) {
  const pathname = usePathname();
  const visible = LINKS.filter((l) => canSee(l.roles, role));

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
