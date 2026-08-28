import { NextResponse } from "next/server";
import type { PartyType, PurchaseType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { PARTY_TYPES } from "@/lib/party";
import { PURCHASE_TYPES } from "@/lib/purchase";

/**
 * Type-ahead search over the party master.
 *
 * Deliberately a Route Handler rather than a Server Action: Next dispatches
 * Server Actions one at a time per client, so driving autocomplete through one
 * would queue every keystroke behind the previous request and feel broken on a
 * slow connection. A GET has no such serialisation.
 *
 * Matching is case-insensitive, and results are ordered prefix-first: typing
 * "a" puts every name *beginning* with A above names that merely contain one,
 * and "ab" narrows that to names beginning "ab". Substring matches are still
 * returned underneath, because a boat recorded as "KL-15 Amina" has to stay
 * findable by typing "amina" — but they never push a prefix match off the list.
 *
 * Each result carries the party's current balance in the active centre, which
 * is what lets the payment and receipt forms show the outstanding position the
 * moment a party is picked instead of after saving.
 */
const LIMIT = 20;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  // `types` narrows the list to the party kinds that make sense for the form
  // doing the asking. Unknown values are dropped rather than trusted.
  const requested = (url.searchParams.get("types") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is PartyType => PARTY_TYPES.includes(t as PartyType));

  // Narrows purchase parties to the kind of bill being entered, so a Private
  // purchase stops suggesting KFDC and every local seller. Parties with no kind
  // recorded are deliberately kept: null means "no purchase has classified them
  // yet", and hiding them would make a party invisible on the very form that
  // would have filed them.
  const rawKind = url.searchParams.get("purchaseKind");
  const purchaseKind = PURCHASE_TYPES.includes(rawKind as PurchaseType)
    ? (rawKind as PurchaseType)
    : null;

  // A centre is NOT required to suggest names. The party master is company-wide
  // — it is the one table the schema does not scope by centre — so bailing out
  // here (which this used to do) made every suggestion silently empty on an
  // install that had not created its first centre yet: the name was plainly
  // there in Masters and the form offered nothing, with no error to explain it.
  // The centre is only needed for the balance column, so it is optional now and
  // its absence costs the figures, not the suggestions.
  // Narrows nothing, but REORDERS: vendors this head has been paid before come
  // first. Picking Ice and being shown the canteen man alongside the ice plant
  // is technically a correct list and practically a useless one — the name the
  // merchant wants is nearly always one they have used under this head before.
  const expenseCategoryId = url.searchParams.get("expenseCategory");

  const { company, centre } = await getActiveScope();

  const base: Prisma.PartyWhereInput = {
    // Archived parties are never offered. Typing an archived name in full
    // still resolves and revives it on save (see findOrCreateParty) — this
    // stops a retired name being picked off a list by accident, which is the
    // whole reason it was retired.
    archivedAt: null,
    ...(requested.length ? { type: { in: requested } } : {}),
    ...(purchaseKind ? { OR: [{ purchaseKind }, { purchaseKind: null }] } : {}),
  };

  const select = { id: true, name: true, type: true } as const;

  // Who has been paid under this head before, in this company and centre.
  // One grouped query; empty when no head was named, which leaves the ordinary
  // prefix-first behaviour exactly as it was.
  let seenIds: string[] = [];
  if (expenseCategoryId && centre) {
    const rows = await prisma.expense.findMany({
      where: {
        companyId: company.id,
        centreId: centre.id,
        categoryId: expenseCategoryId,
        partyId: { not: null },
      },
      select: { partyId: true },
      distinct: ["partyId"],
      take: 200,
    });
    seenIds = rows.map((r) => r.partyId!).filter(Boolean);
  }

  /**
   * One pass of the search, restricted to a set of ids or excluding the ones
   * already found. Passes run in priority order and each takes only what the
   * ones before it left room for, so the cap always falls on the least
   * relevant names rather than on the best ones.
   */
  const found: { id: string; name: string; type: PartyType }[] = [];
  const room = () => LIMIT - found.length;
  const pass = async (where: Prisma.PartyWhereInput) => {
    if (room() <= 0) return;
    const rows = await prisma.party.findMany({
      where: {
        ...base,
        ...where,
        ...(found.length ? { id: { notIn: found.map((p) => p.id) } } : {}),
      },
      select,
      orderBy: { name: "asc" },
      take: room(),
    });
    found.push(...rows);
  };

  // Separate passes rather than one query sorted in memory. Sorting after a
  // single capped query would be wrong, not just slower: `take` applies before
  // the sort, so a prefix match sitting 30 names down the alphabet would be cut
  // before it could be promoted. Running the best passes first guarantees they
  // are the ones that survive the cap.
  //
  //   1. used under this head, and the name starts with what was typed
  //   2. used under this head, name contains it
  //   3. any matching party, prefix
  //   4. any matching party, contains
  //
  // With no head named, 1 and 2 are empty and this is exactly the prefix-first
  // behaviour it has always had.
  const seen = seenIds.length ? { id: { in: seenIds } } : null;

  if (q) {
    if (seen) {
      await pass({ ...seen, name: { startsWith: q, mode: "insensitive" } });
      await pass({ ...seen, name: { contains: q, mode: "insensitive" } });
    }
    await pass({ name: { startsWith: q, mode: "insensitive" } });
    await pass({ name: { contains: q, mode: "insensitive" } });
  } else {
    // Nothing typed yet. A freshly focused field shows the names this head has
    // actually used, which on most days is the whole answer.
    if (seen) await pass(seen);
    await pass({});
  }

  const all = found;

  if (all.length === 0) return NextResponse.json({ parties: [] });

  // Balances for the whole result set in one grouped query — never one query
  // per row, which would turn a 20-item dropdown into 20 round trips. Skipped
  // entirely with no centre, where there is no ledger to read against.
  const balance = new Map<string, number>();
  if (centre) {
    const sums = await prisma.ledgerEntry.groupBy({
      by: ["partyId", "type"],
      where: {
        companyId: company.id,
        centreId: centre.id,
        partyId: { in: all.map((p) => p.id) },
      },
      _sum: { amount: true },
    });

    for (const s of sums) {
      const signed = (s.type === "DEBIT" ? 1 : -1) * Number(s._sum.amount ?? 0);
      balance.set(s.partyId, (balance.get(s.partyId) ?? 0) + signed);
    }
  }

  return NextResponse.json({
    parties: all.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      balance: balance.get(p.id) ?? 0,
    })),
  });
}
