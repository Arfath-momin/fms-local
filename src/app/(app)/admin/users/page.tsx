import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { canSuperAdminister, requireSession } from "@/lib/session";
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
  // Super admin only. An admin reaching this by typed URL is bounced rather
  // than shown an error: they have no business here, but arriving is a
  // navigation mistake (a stale bookmark from when this was theirs), not an
  // attack. The actions enforce the same rule independently.
  if (!canSuperAdminister(session.role)) redirect("/dashboard");

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

  // Everyone reaching this page is a super admin, so every control is offered
  // on every row. The one exception is handled inline below: a super admin may
  // not change their own role or deactivate themselves, because ROLES cannot
  // express SUPER_ADMIN and the demotion is only reversible from the shell.
  const isSelf = (userId: string) => userId === session.userId;

  return (
    <div className="max-w-4xl">
      <h1 className="heading text-xl font-semibold mb-1">Users</h1>
      <p className="text-muted text-[13px] mb-4">
        Who can sign in, and what they are allowed to do. There is no self-signup
        — every account is created here, by the system owner only.
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
                  {u.isActive && !isSelf(u.id) ? (
                    <RoleForm userId={u.id} role={u.role} />
                  ) : (
                    ROLE_LABELS[u.role]
                  )}
                </td>
                <td>
                  {/* A super admin is never filtered by grants, so editing
                      theirs would change nothing — show "All" instead. */}
                  {u.isActive && u.role !== "SUPER_ADMIN" ? (
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
                    {u.isActive && <ResetPasswordForm userId={u.id} />}
                    {!isSelf(u.id) && (
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
          <li>
            <span className="font-semibold">Super Admin</span> — everything an
            admin can do, plus this screen: who may sign in, what role they
            hold, and which companies they can open. Also restores an archived
            centre or party and deletes an unused one for good. Cannot be
            granted from here; it is set on the server.
          </li>
          <li>
            <span className="font-semibold">Admin</span> — runs the books.
            Everything else, including changing a voucher after it is saved and
            archiving a centre or party that is no longer needed. Does not
            manage accounts and never sees this screen.
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
