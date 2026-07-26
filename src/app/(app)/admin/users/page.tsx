import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { canAdminister, requireSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import {
  ActiveForm,
  CreateUserForm,
  ResetPasswordForm,
  RoleForm,
} from "./user-forms";

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  ACCOUNTANT: "Accountant",
  AUDITOR: "Auditor / CA",
};

export default async function UsersPage() {
  const session = await requireSession();
  if (!canAdminister(session.role)) redirect("/dashboard");

  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
  });

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
                  {u.isActive ? (
                    <RoleForm userId={u.id} role={u.role} />
                  ) : (
                    ROLE_LABELS[u.role]
                  )}
                </td>
                <td className="text-muted text-[12px]">
                  {fmtDateTime(u.createdAt)}
                </td>
                <td>
                  <div className="flex gap-3">
                    {u.isActive && <ResetPasswordForm userId={u.id} />}
                    {u.id !== session.userId && (
                      <ActiveForm userId={u.id} isActive={u.isActive} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateUserForm />

      <div className="mt-6 text-[12px] text-muted max-w-lg">
        <p className="font-semibold text-foreground mb-1">What each role can do</p>
        <ul className="space-y-1">
          <li>
            <span className="font-semibold">Admin</span> — everything, and the
            only role that can change a voucher after it is saved.
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
