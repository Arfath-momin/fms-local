"use client";

import { useEffect, useState } from "react";

/**
 * The sidebar, and how it behaves on a small screen.
 *
 * On a desktop it is simply always there — a fixed gateway column, which is the
 * Tally-style navigation the design calls for. On a phone that column is 208px
 * of a 375px screen, leaving too little for a ledger table to be readable at
 * all, so below `md` it becomes a drawer behind a menu button.
 *
 * The sidebar's CONTENT stays server-rendered and arrives as children — this
 * component owns only the open/closed state. That keeps the company and centre
 * switchers, which are Server Action forms, exactly as they were.
 */
export function AppShell({
  sidebar,
  children,
  companyName,
  centreName,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  companyName: string;
  centreName: string | null;
}) {
  const [open, setOpen] = useState(false);

  // A drawer that scrolls the page behind it feels broken, and on iOS the
  // background scroll is what you get instead of the drawer moving.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes it, as any overlay should.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Mobile top bar. Carries the company name as well as the button,
          because "never be in doubt whose books are on screen" matters more on
          a small screen, not less — the company band below is easy to scroll
          past on a phone. */}
      <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 bg-sidebar text-sidebar-ink px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="flex items-center justify-center h-9 w-9 border border-white/25 text-white"
        >
          {/* Three bars, drawn rather than an icon font — nothing else in the
              app pulls in an icon dependency. */}
          <span aria-hidden className="relative block w-4">
            <span className="block h-[2px] bg-current mb-[3px]" />
            <span className="block h-[2px] bg-current mb-[3px]" />
            <span className="block h-[2px] bg-current" />
          </span>
        </button>
        <div className="min-w-0">
          <div className="heading text-white text-[15px] font-semibold leading-none truncate">
            {companyName}
          </div>
          {centreName && (
            <div className="text-[11px] text-sidebar-ink/70 truncate">
              {centreName}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-screen">
        {/* Scrim. Click-through would leave the drawer open over a page the
            user is trying to read. */}
        {open && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="md:hidden fixed inset-0 z-40 bg-black/50"
          />
        )}

        <aside
          // Navigating closes the drawer — without this, tapping a link on a
          // phone leaves it covering the page you just asked for. Delegated
          // from the wrapper rather than set on each link, because the links
          // and the switcher forms are server-rendered children.
          onClick={(e) => {
            const el = e.target as HTMLElement;
            if (el.closest("a") || el.closest("button[type=submit]"))
              setOpen(false);
          }}
          className={
            "bg-sidebar text-sidebar-ink flex flex-col shrink-0 " +
            // Off-canvas on a phone, in-flow from md up. `fixed` only below md
            // so the desktop column keeps its place in the flex row.
            "fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto transition-transform " +
            (open ? "translate-x-0" : "-translate-x-full") +
            " md:static md:translate-x-0 md:w-52 md:overflow-visible md:transition-none"
          }
        >
          {sidebar}
        </aside>

        <div className="flex-1 flex flex-col min-w-0">{children}</div>
      </div>
    </>
  );
}
