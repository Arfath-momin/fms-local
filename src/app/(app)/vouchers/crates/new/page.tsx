import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { crateBalances } from "@/lib/crate";
import { tripOptions } from "@/lib/trip";
import { createCrateEntry } from "../actions";
import { CrateEntryForm } from "../crate-form";
import { NoCentreNotice } from "../../../no-centre";

export default async function NewCrateEntryPage() {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/ledgers/boxes");

  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;
  const scope = { companyId: company.id, centreId: centre.id };

  const [holdings, trips] = await Promise.all([
    crateBalances(scope),
    tripOptions(scope),
  ]);

  // What each market's bills say it took off each of these trips — the number
  // the form offers as a starting point. Read once for every trip on the page
  // rather than on each keystroke, because it is a suggestion and does not need
  // to be live.
  //
  // MARKET only. A factory or fish mill takes the fish and the crates come
  // straight back on the same truck, so they never hold any.
  const sales = await prisma.sale.findMany({
    where: {
      ...scope,
      type: "MARKET",
      deliveryNoteId: { in: trips.map((t) => t.id) },
    },
    select: {
      deliveryNoteId: true,
      party: { select: { name: true } },
      lines: { select: { box: true, pack: true } },
    },
  });
  const billedBoxes: Record<string, number> = {};
  for (const s of sales) {
    if (!s.deliveryNoteId) continue;
    const key = `${s.deliveryNoteId}|${s.party.name.toLowerCase()}`;
    billedBoxes[key] =
      (billedBoxes[key] ?? 0) +
      s.lines
        // LOOSE fish never went into a crate — it rides on the truck bed.
        .filter((l) => l.pack !== "LOOSE")
        .reduce((a, l) => a + (l.box ?? 0), 0);
  }

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">Crates</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · {centre.name}. Crates are yours, on loan to the market
        until the empties come back. This records what went out and what
        returned; the balance is worked out from the rows, never stored.
      </p>
      <CrateEntryForm
        action={createCrateEntry}
        holdings={holdings.map((b) => ({
          partyId: b.partyId,
          partyName: b.partyName,
          holding: b.holding,
        }))}
        trips={trips}
        billedBoxes={billedBoxes}
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
