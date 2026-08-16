import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { canSuperAdminister, requireSession } from "@/lib/session";
import { suggestCompanyColour } from "@/lib/company-theme";
import { fmtDate } from "@/lib/format";
import { createCompany, updateCompany } from "./actions";
import { CompanyForm } from "./company-form";
import { DeleteCompany } from "./delete-company";

/**
 * The company master — super admin only.
 *
 * Deliberately not something the merchant's own admin can reach. A company is
 * the top-level boundary every other permission is expressed against: who may
 * see which books, which ledgers a voucher lands in, what the printed bill
 * says. Handing that to the people it exists to separate would defeat it.
 *
 * Its other job is removing the last reason to run db:seed on a live server.
 * Companies used to exist only if that script made them, and it ships accounts
 * whose passwords are published in this repository.
 */
export default async function CompaniesPage() {
  const session = await requireSession();
  if (!canSuperAdminister(session.role)) redirect("/dashboard");

  const companies = await prisma.company.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          centres: true,
          purchases: true,
          sales: true,
          expenses: true,
          deliveryNotes: true,
          settlements: true,
          ledgerEntries: true,
          attachments: true,
          dayCloses: true,
          reviewRequests: true,
          users: true,
        },
      },
    },
  });

  return (
    <div className="max-w-3xl">
      <h1 className="heading text-xl font-semibold mb-1">Companies</h1>
      <p className="text-muted text-[13px] mb-4">
        Each company is a separate set of books. Only you can add one —
        administrators manage centres, parties and users inside the companies
        they have been granted.
      </p>

      {companies.map((c) => {
        // `users` is a grant, not something the company owns, so it does not
        // block deletion — the grants cascade with the row.
        const { users: _grants, ...owned } = c._count;
        const refs = Object.values(owned).reduce((a, b) => a + b, 0);

        return (
          <section key={c.id} className="mb-6">
            <div className="flex items-center justify-between gap-3 mb-2 border-b border-line-strong pb-1">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-4 w-4 border border-black/20"
                  style={{ background: c.colour ?? "#1e4d8c" }}
                />
                <h2 className="heading text-[16px] font-semibold">{c.name}</h2>
                <span className="text-muted text-[12px]">
                  {c._count.centres} centre
                  {c._count.centres === 1 ? "" : "s"} · {refs} record
                  {refs === 1 ? "" : "s"} · added {fmtDate(c.createdAt)}
                </span>
              </div>
              <DeleteCompany
                companyId={c.id}
                name={c.name}
                references={refs}
                isOnly={companies.length === 1}
              />
            </div>

            <CompanyForm
              action={updateCompany.bind(null, c.id)}
              submitLabel="Save changes"
              initial={{
                id: c.id,
                name: c.name,
                colour: c.colour ?? "#1e4d8c",
                legalName: c.legalName ?? "",
                address: c.address ?? "",
                phone: c.phone ?? "",
                email: c.email ?? "",
                contactPerson: c.contactPerson ?? "",
                gstin: c.gstin ?? "",
                hasLogo: c.logoKey !== null,
              }}
            />
          </section>
        );
      })}

      <div className="mt-8">
        <h2 className="heading text-[16px] font-semibold mb-2 border-b border-line-strong pb-1">
          Add a company
        </h2>
        <CompanyForm
          action={createCompany}
          submitLabel="Add company"
          defaultColour={suggestCompanyColour(companies.map((c) => c.colour))}
        />
      </div>

      <p className="text-muted text-[12px] mt-4 max-w-xl">
        A new company starts empty. Add its first centre under{" "}
        <span className="font-medium">Masters → Centres</span> while it is the
        active company, then grant people access to it from{" "}
        <span className="font-medium">Users</span>.
      </p>
    </div>
  );
}
