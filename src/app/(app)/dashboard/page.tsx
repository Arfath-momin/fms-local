import { getActiveCompany } from "@/lib/company";

export default async function DashboardPage() {
  const company = await getActiveCompany();

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">Dashboard</h1>
      <p className="text-muted text-[13px] mb-6">
        Today&apos;s snapshot for {company.name}.
      </p>
      <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
        Snapshot tiles (purchase, sale, expense, profit, outstanding, stock)
        arrive in Phase 8. Start with Masters → Parties.
      </p>
    </div>
  );
}
