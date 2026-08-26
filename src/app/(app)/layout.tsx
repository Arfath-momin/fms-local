import Link from "next/link";
import type { Role } from "@/generated/prisma/enums";
import { requireSession } from "@/lib/session";
import { getActiveCompany, getCompanies } from "@/lib/company";
import { getActiveCentre, getCentres } from "@/lib/centre";
import { logout, switchCompany, switchCentre } from "./actions";
import { NoCompanyNotice } from "./no-company";
import { NavLinks } from "./nav-links";
import { BackLink } from "./back-link";
import { AppShell } from "./app-shell";

const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin · system owner",
  ADMIN: "Admin",
  ACCOUNTANT: "Accountant · entry only",
  AUDITOR: "Auditor · read-only",
};

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();

  // Only the companies this account holds — the switcher below is rendered from
  // the same list getActiveCompany() enforces against, so it can never offer a
  // company that would then be refused.
  const companies = await getCompanies();
  if (companies.length === 0) return <NoCompanyNotice name={session.name} />;

  const activeCompany = await getActiveCompany();
  const [centres, activeCentre] = await Promise.all([
    getCentres(activeCompany.id),
    getActiveCentre(activeCompany.id),
  ]);

  return (
    <div
      data-company={activeCompany.name}
      // Inline so it beats the [data-company] rules in globals.css, which only
      // know about BFM and B2B. A company added from the Companies screen
      // carries its own colour and must not fall back to BFM's.
      style={
        activeCompany.colour
          ? ({ "--company": activeCompany.colour } as React.CSSProperties)
          : undefined
      }
      className="flex-1 flex flex-col min-h-screen"
    >
      {/* Gateway sidebar — Tally-style top-level sections. AppShell owns only
          whether it is on screen; everything inside stays server-rendered, so
          the company and centre switchers remain Server Action forms. */}
      <AppShell
        companyName={activeCompany.name}
        centreName={activeCentre?.name ?? null}
        sidebar={
          <>
            <div className="px-4 py-4 border-b border-white/10">
          <div className="heading text-white text-lg font-semibold leading-none">
            FMS
          </div>
          {/* Company switcher — unmistakable when there is a choice to make
              (design doc #1). A user granted one company gets a plain label
              instead: a single button that only ever reloads the same screen
              reads as broken. */}
          <div className="mt-3 flex gap-1">
            {companies.length === 1 && (
              <div
                data-company={activeCompany.name}
                className="w-full py-1.5 text-center text-[12px] font-bold tracking-wide bg-company text-company-ink"
              >
                {activeCompany.name}
              </div>
            )}
            {companies.length > 1 &&
              companies.map((c) => {
                const active = c.id === activeCompany.id;
                return (
                  <form action={switchCompany} key={c.id} className="flex-1">
                    <input type="hidden" name="companyId" value={c.id} />
                    <button
                      type="submit"
                      aria-pressed={active}
                      data-company={c.name}
                      style={
                        c.colour
                          ? ({ "--company": c.colour } as React.CSSProperties)
                          : undefined
                      }
                      className={
                        "w-full py-1.5 text-[12px] font-bold tracking-wide border " +
                        (active
                          ? "bg-company text-company-ink border-transparent"
                          : "bg-transparent text-sidebar-ink/70 border-white/20 hover:border-white/50")
                      }
                    >
                      {c.name}
                    </button>
                  </form>
                );
              })}
          </div>

          {/* Centre switcher — the active centre scopes every entry and ledger */}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-widest text-sidebar-ink/50 mb-1">
              Centre
            </div>
            {centres.length === 0 ? (
              <Link
                href="/masters/centres"
                className="block text-[12px] text-amber-300 underline underline-offset-2"
              >
                Add a centre →
              </Link>
            ) : (
              <div className="flex flex-col gap-1">
                {centres.map((c) => {
                  const active = c.id === activeCentre?.id;
                  return (
                    <form action={switchCentre} key={c.id}>
                      <input type="hidden" name="centreId" value={c.id} />
                      <button
                        type="submit"
                        aria-pressed={active}
                        className={
                          "w-full text-left px-2 py-1 text-[12px] font-medium border " +
                          (active
                            ? "bg-white/15 text-white border-white/30"
                            : "bg-transparent text-sidebar-ink/70 border-white/10 hover:border-white/40")
                        }
                      >
                        {c.name}
                      </button>
                    </form>
                  );
                })}
              </div>
            )}
          </div>
        </div>

            <NavLinks role={session.role} />

            <div className="mt-auto px-4 py-3 border-t border-white/10 text-[12px]">
          <div className="text-white">{session.name}</div>
          <div className="text-sidebar-ink/60">{ROLE_LABELS[session.role]}</div>
          <form action={logout} className="mt-2">
            <button
              type="submit"
              className="text-sidebar-ink/70 hover:text-white underline underline-offset-2"
            >
              Sign out
            </button>
              </form>
            </div>
          </>
        }
      >
        {/* Company band — constant, colored, impossible to miss (design doc #1) */}
        {/* Hidden on a phone: the mobile top bar already carries the company
            and centre, and repeating them here would cost a whole band of a
            short screen to say the same thing twice. */}
        <header className="hidden md:flex bg-company text-company-ink px-6 py-2 items-center justify-between gap-4">
          <span className="text-[13px] font-bold tracking-widest uppercase flex items-center gap-2">
            {activeCompany.hasLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/company-logo/${activeCompany.id}`}
                alt=""
                className="h-5 w-5 object-contain"
              />
            )}
            {activeCompany.name}
            {activeCentre ? (
              <span className="font-medium normal-case tracking-normal opacity-90">
                {" · "}
                {activeCentre.name}
              </span>
            ) : null}
          </span>
          <span className="text-[12px] opacity-80 hidden lg:inline text-right">
            {activeCentre
              ? `Entries and figures on screen belong to ${activeCompany.name} · ${activeCentre.name}`
              : `${activeCompany.name} has no centre yet — add one under Masters`}
          </span>
        </header>
        {/* Tighter gutters on a phone: 24px each side of a 375px screen is
            13% of the width gone before any figure is drawn. */}
        <main className="flex-1 p-3 sm:p-6 overflow-x-auto">
          {/* Derived from the URL, so every screen below a top-level section
              has a way back without each page carrying its own copy. */}
          <BackLink />
          {children}
        </main>
      </AppShell>
    </div>
  );
}
