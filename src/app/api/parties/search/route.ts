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

  // Two passes rather than one sorted in memory. Sorting after a single capped
  // query would be wrong, not just slower: `take` applies before the sort, so a
  // prefix match sitting 30 names down the alphabet would be cut before it
  // could be promoted. Asking for the prefixes first guarantees they are the
  // ones that survive the cap.
  const prefix = q
    ? await prisma.party.findMany({
        where: { ...base, name: { startsWith: q, mode: "insensitive" } },
        select,
        orderBy: { name: "asc" },
        take: LIMIT,
      })
    : [];

  // Only top up when the prefix pass left room, so the common case of a
  // well-matched query stays a single query.
  const remaining = LIMIT - prefix.length;
  const contains =
    q && remaining > 0
      ? await prisma.party.findMany({
          where: {
            ...base,
            name: { contains: q, mode: "insensitive" },
            id: { notIn: prefix.map((p) => p.id) },
          },
          select,
          orderBy: { name: "asc" },
          take: remaining,
        })
      : [];

  // Empty query: the plain alphabetical list, which is what a freshly focused
  // field should show before anything is typed.
  const all = q
    ? [...prefix, ...contains]
    : await prisma.party.findMany({
        where: base,
        select,
        orderBy: { name: "asc" },
        take: LIMIT,
      });

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
