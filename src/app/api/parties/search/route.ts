import { NextResponse } from "next/server";
import type { PartyType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { PARTY_TYPES } from "@/lib/party";

/**
 * Type-ahead search over the party master.
 *
 * Deliberately a Route Handler rather than a Server Action: Next dispatches
 * Server Actions one at a time per client, so driving autocomplete through one
 * would queue every keystroke behind the previous request and feel broken on a
 * slow connection. A GET has no such serialisation.
 *
 * Matching is case-insensitive and substring-based, so "b", "bh", "bha" and
 * "BhA" all find "BHA".
 *
 * Each result carries the party's current balance in the active centre, which
 * is what lets the payment and receipt forms show the outstanding position the
 * moment a party is picked instead of after saving.
 */
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

  const { company, centre } = await getActiveScope();
  if (!centre) return NextResponse.json({ parties: [] });

  const parties = await prisma.party.findMany({
    where: {
      ...(requested.length ? { type: { in: requested } } : {}),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    select: { id: true, name: true, type: true },
    orderBy: { name: "asc" },
    take: 20,
  });

  if (parties.length === 0) return NextResponse.json({ parties: [] });

  // Balances for the whole result set in one grouped query — never one query
  // per row, which would turn a 20-item dropdown into 20 round trips.
  const sums = await prisma.ledgerEntry.groupBy({
    by: ["partyId", "type"],
    where: {
      companyId: company.id,
      centreId: centre.id,
      partyId: { in: parties.map((p) => p.id) },
    },
    _sum: { amount: true },
  });

  const balance = new Map<string, number>();
  for (const s of sums) {
    const signed =
      (s.type === "DEBIT" ? 1 : -1) * Number(s._sum.amount ?? 0);
    balance.set(s.partyId, (balance.get(s.partyId) ?? 0) + signed);
  }

  return NextResponse.json({
    parties: parties.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      balance: balance.get(p.id) ?? 0,
    })),
  });
}
