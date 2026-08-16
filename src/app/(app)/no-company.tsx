import { logout } from "./actions";

/**
 * Shown when a signed-in account has been granted no company.
 *
 * Not a normal state — the Users screen refuses to leave an account with none —
 * but it is reachable if the last grant is removed while the person is signed
 * in. Better a plain explanation and a way out than a crash on every screen,
 * and it names what the admin has to do rather than leaving the user guessing.
 */
export function NoCompanyNotice({ name }: { name: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-lg border border-line bg-surface px-5 py-5">
        <h1 className="heading text-lg font-semibold mb-1">No company access</h1>
        <p className="text-muted text-[13px]">
          {name}, your account is not attached to any company yet, so there is
          nothing to show. An administrator can grant access from{" "}
          <span className="font-medium">Users</span>.
        </p>
        <form action={logout} className="mt-4">
          <button
            type="submit"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
