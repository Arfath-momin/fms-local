"use client";

import { useActionState, useState } from "react";
import type { Role } from "@/generated/prisma/enums";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import {
  createUser,
  resetPassword,
  setUserActive,
  setUserRole,
  type UserFormState,
} from "./actions";

const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: "ADMIN", label: "Admin", hint: "Full access. The only role that can edit a saved voucher." },
  { value: "ACCOUNTANT", label: "Accountant", hint: "Enters vouchers and manages parties. Cannot edit once saved." },
  { value: "AUDITOR", label: "Auditor / CA", hint: "Read-only. Ledgers and reports, no voucher menu." },
];

/** A generated password is shown exactly once — it is never stored in clear. */
function Result({ state }: { state: UserFormState }) {
  if (!state) return null;
  if ("error" in state)
    return <p className="text-debit text-[13px] mt-2">{state.error}</p>;
  return (
    <div className="text-[13px] mt-2">
      <p className="text-credit">{state.ok}</p>
      {state.password && (
        <p className="mt-1">
          <code className="bg-surface border border-line-strong px-2 py-1 font-mono text-[13px]">
            {state.password}
          </code>
          <span className="text-muted ml-2">
            Shown once — copy it now and give it to them directly.
          </span>
        </p>
      )}
    </div>
  );
}

export function CreateUserForm() {
  const [state, action, pending] = useActionState<UserFormState, FormData>(
    createUser,
    null
  );

  return (
    <form action={action} className="border border-line-strong bg-surface p-4 max-w-lg">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-3">
        Add a user
      </h2>

      <div className="grid gap-3">
        <label className="block">
          <span className="block text-[12px] font-semibold mb-1">Name</span>
          <input
            name="name"
            required
            className="w-full border border-line-strong bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="block">
          <span className="block text-[12px] font-semibold mb-1">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            className="w-full border border-line-strong bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>

        <fieldset>
          <legend className="text-[12px] font-semibold mb-1">Role</legend>
          <div className="grid gap-1.5">
            {ROLE_OPTIONS.map((r, i) => (
              <label key={r.value} className="flex gap-2 items-start text-[13px]">
                <input
                  type="radio"
                  name="role"
                  value={r.value}
                  defaultChecked={i === 1}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">{r.label}</span>
                  <span className="block text-muted text-[12px]">{r.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="block text-[12px] font-semibold mb-1">
            Password{" "}
            <span className="font-normal text-muted">
              — leave blank to generate a strong one
            </span>
          </span>
          <input
            name="password"
            type="text"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            className="w-full border border-line-strong bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-4 bg-accent text-white px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create user"}
      </button>

      <Result state={state} />
    </form>
  );
}

export function RoleForm({ userId, role }: { userId: string; role: Role }) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(
    setUserRole,
    null
  );

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={role}
        className="border border-line-strong bg-background px-1.5 py-1 text-[12px] outline-none focus:border-accent"
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="border border-line-strong px-2 py-1 text-[12px] hover:border-accent disabled:opacity-60"
      >
        Save
      </button>
      {state && "error" in state && (
        <span className="text-debit text-[12px]">{state.error}</span>
      )}
    </form>
  );
}

/**
 * Reset in two steps: a link, then a field.
 *
 * The field stays hidden until the link is clicked so the common case — "just
 * give them a new one" — is still a single click, while an admin who wants to
 * set a password they can read down the phone has somewhere to type it. Blank
 * generates, exactly as it does when creating an account.
 */
export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(
    resetPassword,
    null
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-accent underline underline-offset-2 text-[12px]"
        >
          Reset password
        </button>
        <Result state={state} />
      </div>
    );
  }

  return (
    <form action={action} className="min-w-52">
      <input type="hidden" name="userId" value={userId} />
      <label className="block">
        <span className="block text-[11px] font-semibold text-muted mb-1">
          New password{" "}
          <span className="font-normal">— blank generates one</span>
        </span>
        <input
          name="password"
          type="text"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          className="w-full border border-line-strong bg-background px-2 py-1 text-[12px] outline-none focus:border-accent"
        />
      </label>
      <div className="flex gap-2 mt-1.5">
        <button
          type="submit"
          disabled={pending}
          className="text-accent font-semibold underline underline-offset-2 text-[12px] disabled:opacity-60"
        >
          {pending ? "Resetting…" : "Set password"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted underline underline-offset-2 text-[12px]"
        >
          Cancel
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function ActiveForm({
  userId,
  isActive,
}: {
  userId: string;
  isActive: boolean;
}) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(
    setUserActive,
    null
  );

  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="isActive" value={String(!isActive)} />
      <button
        type="submit"
        disabled={pending}
        className="text-accent underline underline-offset-2 text-[12px] disabled:opacity-60"
      >
        {isActive ? "Deactivate" : "Reactivate"}
      </button>
      {state && "error" in state && (
        <p className="text-debit text-[12px] mt-1">{state.error}</p>
      )}
    </form>
  );
}
