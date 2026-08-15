import Link from "next/link";
import { PAGE_SIZE, listHref, type ListWindow } from "@/lib/paging";
import { DateField } from "./date-field";

// Shared controls for the voucher and ledger lists. Both are plain server
// components: the filter is a GET form and the pager is a pair of links, so the
// whole thing works with no client JavaScript and every view is a real URL that
// can be bookmarked, shared, or opened in a second tab.

export function DateWindow({
  basePath,
  window: w,
}: {
  basePath: string;
  window: ListWindow;
}) {
  return (
    <form
      method="get"
      action={basePath}
      className="flex items-end gap-2 mb-4 text-[13px]"
    >
      <label className="flex flex-col gap-1">
        <span className="text-muted text-[12px]">From</span>
        <DateField
          
          name="from"
          defaultValue={w.from}
          className="border border-line-strong bg-surface px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted text-[12px]">To</span>
        <DateField
          
          name="to"
          defaultValue={w.to}
          className="border border-line-strong bg-surface px-2 py-1"
        />
      </label>
      <button
        type="submit"
        className="border border-line-strong px-3 py-1.5 font-medium hover:bg-line-strong/10"
      >
        Apply
      </button>
      <Link
        href={basePath}
        className="text-accent underline underline-offset-2 text-[12px] pb-2"
      >
        This month
      </Link>
    </form>
  );
}

export function Pager({
  basePath,
  window: w,
  total,
}: {
  basePath: string;
  window: ListWindow;
  total: number;
}) {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : w.skip + 1;
  const lastRow = Math.min(w.skip + PAGE_SIZE, total);

  // One page of results needs no controls, but the count is still worth stating
  // so it is obvious the list is windowed rather than complete.
  if (total <= PAGE_SIZE) {
    return (
      <p className="text-muted text-[12px] mt-2">
        {total} {total === 1 ? "entry" : "entries"} between {w.from} and {w.to}.
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between mt-2 text-[12px]">
      <span className="text-muted">
        Showing {firstRow}–{lastRow} of {total} between {w.from} and {w.to}.
      </span>
      <span className="flex items-center gap-3">
        {w.page > 1 ? (
          <Link
            href={listHref(basePath, w, { page: w.page - 1 })}
            className="text-accent underline underline-offset-2"
          >
            ← Previous
          </Link>
        ) : (
          <span className="text-muted opacity-50">← Previous</span>
        )}
        <span className="text-muted">
          Page {w.page} of {lastPage}
        </span>
        {w.page < lastPage ? (
          <Link
            href={listHref(basePath, w, { page: w.page + 1 })}
            className="text-accent underline underline-offset-2"
          >
            Next →
          </Link>
        ) : (
          <span className="text-muted opacity-50">Next →</span>
        )}
      </span>
    </div>
  );
}
