import "../globals.css";

/**
 * The bare document a printable voucher renders into — no sidebar, no company
 * switcher, no navigation.
 *
 * It is a separate route group rather than a flag on the app layout because the
 * app chrome is not something to hide at print time; it should never be built
 * for this page in the first place. The print rules themselves live beside the
 * bill in print.css, so no other screen pays for them.
 */
export default function PrintLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex-1 bg-background">{children}</div>;
}
