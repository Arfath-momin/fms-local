"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    null
  );

  return (
    <form action={action} className="px-6 py-5 space-y-4">
      <div>
        <label htmlFor="email" className="block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      {state?.error && (
        <p className="text-debit text-[13px]">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full bg-accent text-white py-2 text-sm font-semibold disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
