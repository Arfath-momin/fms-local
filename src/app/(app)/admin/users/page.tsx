import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { canAdminister, requireSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import {
  ActiveForm,
  CompaniesForm,
  CreateUserForm,
  ResetPasswordForm,
  RoleForm,
} from "./user-forms";

const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  ACCOUNTANT: "Accountant",
  AUDITOR: "Auditor / CA",
};

export default async function UsersPage() {
  const session = await requireSession();
  if (!canAdminister(session.role)) redirect("/dashboard");

  const [users, companies] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
      include: { companies: { select: { companyId: true } } },
    }),
    // Every company in the table, not the viewer's own — an admin granting
    // access needs to see the options they are choosing between. Which of them
    // the *viewer* may enter is a separate question, answered by getCompanies().
    prisma.company.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // A super admin's account is off limits to an ordinary admin — no role
  // dropdown, no password reset, no deactivate — because each of those is a
  // route to taking over the tier above. The server refuses these too; this
  // only stops the buttons being offered. Mirrors assertMayActOn() in actions.
  const mayActOn = (role: Role) =>
    session.role === "SUPER_ADMIN" || role !== "SUPER_ADMIN";

  return (
    <div className="max-w-4xl">
      <h1 className="heading text-xl font-semibold mb-1">Users</h1>
      <p className="text-muted text-[13px] mb-4">
        Who can sign in, and what they are allowed to do. There is no self-signup
        — every account is created here.
      </p>

      <div className="border border-line-strong bg-surface mb-6">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Companies</th>
              <th>Added</th>
              <th className="w-56"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.isActive ? "" : "opacity-50"}>
                <td className="font-medium">
                  {u.name}
                  {u.id === session.userId && (
                    <span className="text-muted text-[12px]"> · you</span>
                  )}
                  {!u.isActive && (
                    <span className="text-debit text-[12px]"> · deactivated</span>
                  )}
                </td>
                <td>{u.email}</td>
                <td>
                  {u.isActive && mayActOn(u.role) ? (
                    <RoleForm userId={u.id} role={u.role} />
                  ) : (
                    ROLE_LABELS[u.role]
                  )}
                </td>
                <td>
                  {u.isActive && mayActOn(u.role) ? (
                    <CompaniesForm
                      userId={u.id}
                      companies={companies}
                      selected={u.companies.map((g) => g.companyId)}
                    />
                  ) : (
                    <span className="text-muted text-[12px]">
                      {u.role === "SUPER_ADMIN"
                        ? "All"
                        : companies
                            .filter((c) =>
                              u.companies.some((g) => g.companyId === c.id)
                            )
                            .map((c) => c.name)
                            .join(", ") || "None"}
                    </span>
                  )}
                </td>
                <td className="text-muted text-[12px]">
                  {fmtDateTime(u.createdAt)}
                </td>
                <td>
                  <div className="flex gap-3">
                    {u.isActive && mayActOn(u.role) && (
                      <ResetPasswordForm userId={u.id} />
                    )}
                    {u.id !== session.userId && mayActOn(u.role) && (
                      <ActiveForm userId={u.id} isActive={u.isActive} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateUserForm companies={companies} />

      <div className="mt-6 text-[12px] text-muted max-w-lg">
        <p className="font-semibold text-foreground mb-1">What each role can do</p>
        <ul className="space-y-1">
          {session.role === "SUPER_ADMIN" && (
            <li>
              <span className="font-semibold">Super Admin</span> — everything an
              admin can do, plus restoring an archived centre or party and
              deleting an unused one for good. Cannot be granted from this
              screen; it is set on the server.
            </li>
          )}
          <li>
            <span className="font-semibold">Admin</span> — runs the books.
            Everything else, including changing a voucher after it is saved and
            archiving a centre or party that is no longer needed.
          </li>
          <li>
            <span className="font-semibold">Accountant</span> — enters purchases,
            sales, expenses and delivery notes, and manages parties. Cannot edit
            an entry once saved; ask an admin.
          </li>
          <li>
            <span className="font-semibold">Auditor / CA</span> — reads ledgers
            and reports and can open any voucher to check the bill image, but
            changes nothing.
          </li>
        </ul>
      </div>
    </div>
  );
}
