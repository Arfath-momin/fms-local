import { requireSession } from "@/lib/session";
import { getActiveCompany, getCompanies } from "@/lib/company";
import { logout, switchCompany } from "./actions";
import { NavLinks } from "./nav-links";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();
  const [companies, activeCompany] = await Promise.all([
    getCompanies(),
    getActiveCompany(),
  ]);

  return (
    <div data-company={activeCompany.name} className="flex-1 flex min-h-screen">
      {/* Gateway sidebar — Tally-style top-level sections */}
      <aside className="w-52 shrink-0 bg-sidebar text-sidebar-ink flex flex-col">
        <div className="px-4 py-4 border-b border-white/10">
          <div className="heading text-white text-lg font-semibold leading-none">
            FMS
          </div>
          {/* Company switcher — always visible, unmistakable (design doc #1) */}
          <div className="mt-3 flex gap-1">
            {companies.map((c) => {
              const active = c.id === activeCompany.id;
              return (
                <form action={switchCompany} key={c.id} className="flex-1">
                  <input type="hidden" name="companyId" value={c.id} />
                  <button
                    type="submit"
                    aria-pressed={active}
                    data-company={c.name}
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
        </div>

        <NavLinks />

        <div className="mt-auto px-4 py-3 border-t border-white/10 text-[12px]">
          <div className="text-white">{session.name}</div>
          <div className="text-sidebar-ink/60">
            {session.role === "MERCHANT" ? "Merchant" : "Auditor · read-only"}
          </div>
          <form action={logout} className="mt-2">
            <button
              type="submit"
              className="text-sidebar-ink/70 hover:text-white underline underline-offset-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Company band — constant, colored, impossible to miss (design doc #1) */}
        <header className="bg-company text-company-ink px-6 py-2 flex items-center justify-between">
          <span className="text-[13px] font-bold tracking-widest uppercase">
            {activeCompany.name}
          </span>
          <span className="text-[12px] opacity-80">
            All entries and figures on screen belong to {activeCompany.name}
          </span>
        </header>
        <main className="flex-1 p-6 overflow-x-auto">{children}</main>
      </div>
    </div>
  );
}
