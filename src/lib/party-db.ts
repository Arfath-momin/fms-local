import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { PartyType } from "@/generated/prisma/enums";

/**
 * Resolve a typed name to a Party, creating it on first use. Parties are
 * global (shared across companies); the ledger that accumulates against them
 * is per company. Names are trimmed and space-collapsed so "Boat A" and
 * "Boat  A" map to the same party rather than splitting a ledger.
 */
export async function findOrCreateParty(
  tx: Prisma.TransactionClient,
  name: string,
  type: PartyType
): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  const existing = await tx.party.findUnique({
    where: { name_type: { name: clean, type } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.party.create({
    data: { name: clean, type },
    select: { id: true },
  });
  return created.id;
}
