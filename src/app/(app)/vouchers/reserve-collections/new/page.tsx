import { redirect } from "next/navigation";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { reserveBalances, WITHHOLDING_LABELS } from "@/lib/reserve";
import type { WithholdingKind } from "@/generated/prisma/enums";
import { createReserveCollection } from "../actions";
import { ReserveCollectionForm } from "../reserve-form";
import { NoCentreNotice } from "../../../no-centre";

export default async function NewReserveCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/ledgers/reserve");

  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  // Which balance this collection clears. Reserve and cutting are separate
  // per-party figures, so the kind has to travel with the money.
  const kind: WithholdingKind =
    (await searchParams).kind === "CUTTING" ? "CUTTING" : "RESERVE";
  const label = WITHHOLDING_LABELS[kind];

  const balances = await reserveBalances(
    { companyId: company.id, centreId: centre.id },
    kind
  );

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">Collect {label}</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · {centre.name}. {label} is money a market party withheld
        from a bill and pays back later, usually at year end. It never sat in
        the trade ledger, so this records the money arriving and clears what
        that party holds — it settles no invoice.
      </p>
      <ReserveCollectionForm
        action={createReserveCollection}
        kind={kind}
        label={label}
        holdings={balances.map((b) => ({
          partyName: b.partyName,
          outstanding: b.outstanding.toNumber(),
        }))}
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
