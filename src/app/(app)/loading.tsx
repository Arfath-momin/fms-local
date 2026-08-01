// Streaming boundary for every screen inside the app shell.
//
// Without a loading.tsx, a navigation blocks until the whole server render
// finishes — all queries, then the HTML — and the browser keeps showing the
// previous page with no feedback at all. With one, Next flushes the sidebar and
// company band immediately and streams the page in behind this skeleton, so a
// click registers instantly no matter how slow the query underneath is.
//
// It also makes <Link> prefetching worth something: Next prefetches links in
// the viewport, but for a dynamic page there is nothing to prefetch until a
// loading boundary exists.
//
// Deliberately generic — one file covers every route in the group. The shape
// below (title, subtitle, table) matches the common case closely enough that
// the swap to real content does not jump.
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="h-6 w-48 bg-line-strong/30 mb-2" />
      <div className="h-4 w-72 bg-line-strong/20 mb-5" />

      <div className="border border-line-strong bg-surface">
        <div className="h-9 border-b border-line-strong bg-line-strong/15" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-8 border-b border-line-strong/40 last:border-b-0 flex items-center gap-4 px-3"
          >
            <div className="h-3 w-28 bg-line-strong/20" />
            <div className="h-3 w-40 bg-line-strong/15" />
            <div className="h-3 w-20 bg-line-strong/20 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
