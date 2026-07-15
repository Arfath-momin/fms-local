import Link from "next/link";

export default function MastersPage() {
  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Masters</h1>
      <div className="max-w-md border border-line bg-surface">
        <Link
          href="/masters/parties"
          className="block px-4 py-3 hover:bg-background border-b border-line last:border-b-0"
        >
          <div className="font-semibold text-[14px]">Parties</div>
          <div className="text-muted text-[12px]">
            Societies, boats, private sellers, factories, markets, mills and
            local buyers — shared across BFM and B2B.
          </div>
        </Link>
      </div>
    </div>
  );
}
