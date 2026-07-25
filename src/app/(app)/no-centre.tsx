import Link from "next/link";

/**
 * Shown on centre-scoped screens when the active company has no centre yet.
 * Every transaction and ledger lives inside a centre, so there is nothing to
 * show until one exists.
 */
export function NoCentreNotice({ companyName }: { companyName: string }) {
  return (
    <div className="max-w-lg border border-line bg-surface px-4 py-4">
      <h1 className="heading text-lg font-semibold mb-1">No centre yet</h1>
      <p className="text-muted text-[13px]">
        {companyName} has no centre. Transactions and ledgers live inside a
        centre — add one to get started.
      </p>
      <Link
        href="/masters/centres"
        className="inline-block mt-3 bg-accent text-white px-4 py-2 text-[13px] font-semibold"
      >
        Add a centre
      </Link>
    </div>
  );
}
