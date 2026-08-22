import Link from "next/link";
import { redirect } from "next/navigation";
import type { SaleType } from "@/generated/prisma/enums";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { SALE_TYPES, SALE_TYPE_LABELS } from "@/lib/sale";
import { openTripsForChannel } from "@/lib/trip";
import { createSale } from "../actions";
import { SaleForm } from "../sale-form";
import { NoCentreNotice } from "../../../no-centre";

const TYPE_HINTS: Record<SaleType, string> = {
  MARKET: "Total & net bill, 2% commission (reference), balance.",
  FISH_MILL: "Item table by variety, weights, vehicle, CareOf option.",
  FACTORY: "Bill amount total, vehicle, return, CareOf option.",
  LOCAL: "Simple item table — particular, qty, rate, total.",
};

export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/vouchers/sales");
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;


  const raw = (await searchParams).type as SaleType | undefined;
  const type = raw && SALE_TYPES.includes(raw) ? raw : null;

  if (!type) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-1">New Sale</h1>
        <p className="text-muted text-[13px] mb-4">
          {company.name} · {centre.name} · choose the sale type.
        </p>
        <div className="max-w-md border border-line bg-surface">
          {SALE_TYPES.map((t) => (
            <Link
              key={t}
              href={`/vouchers/sales/new?type=${t}`}
              className="block px-4 py-3 hover:bg-background border-b border-line last:border-b-0"
            >
              <div className="font-semibold text-[14px]">
                {SALE_TYPE_LABELS[t]}
              </div>
              <div className="text-muted text-[12px]">{TYPE_HINTS[t]}</div>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  // LOCAL has no truck behind it, so no trip to offer.
  const trips =
    type === "LOCAL"
      ? []
      : await openTripsForChannel(
          { companyId: company.id, centreId: centre.id },
          type === "MARKET" ? "MARKET" : type === "FACTORY" ? "FACTORY" : "FISH_MILL"
        );

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">
        New {SALE_TYPE_LABELS[type]} Sale
      </h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · {centre.name}.{" "}
        <Link
          href="/vouchers/sales/new"
          className="text-accent underline underline-offset-2"
        >
          Change type
        </Link>
      </p>
      <SaleForm
        type={type}
        action={createSale}
        trips={trips}
        submitLabel="Save Sale"
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
