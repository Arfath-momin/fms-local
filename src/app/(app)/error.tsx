"use client";

// Catches errors thrown while rendering a page inside the app shell, so a
// failed screen no longer takes the whole application down to a bare "A server
// error occurred" page. The sidebar and company band stay usable, and Retry
// re-runs just the failed segment.
//
// Errors thrown by the app layout itself are not caught here — a segment's
// error boundary cannot catch its own layout — those land in src/app/error.tsx.
//
// Next strips the real message in production and replaces it with a digest.
// Showing that digest is the point: it is what ties the screen the user is
// looking at to the stack trace in the deploy logs.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-lg">
      <h1 className="heading text-xl font-semibold mb-1">
        This screen could not be loaded
      </h1>
      <p className="text-muted text-[13px] mb-4">
        The rest of the app is still working — use the menu to carry on, or try
        again.
      </p>

      <div className="border border-line-strong bg-surface p-3 mb-4">
        <div className="text-[12px] text-muted mb-1">
          Quote this reference when reporting the problem:
        </div>
        <code className="text-[13px]">{error.digest ?? "no reference"}</code>
      </div>

      <button
        type="button"
        onClick={reset}
        className="border border-line-strong px-3 py-1.5 text-[13px] font-medium hover:bg-line-strong/10"
      >
        Try again
      </button>
    </div>
  );
}
