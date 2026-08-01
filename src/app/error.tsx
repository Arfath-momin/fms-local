"use client";

import Link from "next/link";

// Outer boundary: catches anything the app layout itself throws, which the
// error.tsx inside (app) cannot. That is not hypothetical — getActiveCompany()
// returns undefined when the companies table is empty, and the layout then
// reads .name off it, so a fresh deployment with no seed data crashes here on
// the first page load after login.
//
// The app shell is gone by the time this renders, so it deliberately styles
// itself standalone rather than assuming any layout chrome exists.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-lg w-full">
        <h1 className="heading text-xl font-semibold mb-1">
          Something went wrong
        </h1>
        <p className="text-muted text-[13px] mb-4">
          The application could not start this page. If this is a new
          deployment, the most likely cause is that no company has been created
          yet.
        </p>

        <div className="border border-line-strong bg-surface p-3 mb-4">
          <div className="text-[12px] text-muted mb-1">
            Quote this reference when reporting the problem:
          </div>
          <code className="text-[13px]">{error.digest ?? "no reference"}</code>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="border border-line-strong px-3 py-1.5 text-[13px] font-medium hover:bg-line-strong/10"
          >
            Try again
          </button>
          <Link
            href="/login"
            className="border border-line-strong px-3 py-1.5 text-[13px] font-medium hover:bg-line-strong/10"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
