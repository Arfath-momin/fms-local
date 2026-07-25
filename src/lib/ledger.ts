import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  LedgerEntryType,
  LedgerSourceType,
} from "@/generated/prisma/enums";

/**
 * Balance sign convention (used everywhere, incl. statements):
 * positive = party owes us, negative = we owe the party.
 * DEBIT increases the balance, CREDIT decreases it.
 */
export function ledgerDelta(type: LedgerEntryType, amount: Prisma.Decimal) {
  return type === "DEBIT" ? amount : amount.negated();
}

type PostLedgerArgs = {
  companyId: string;
  centreId: string;
  partyId: string;
  type: LedgerEntryType;
  sourceType: LedgerSourceType;
  sourceId: string;
  amount: Prisma.Decimal | string | number;
  date: Date;
};

/**
 * Append a ledger entry, computing the party's running balance per
 * (company, centre). Must run inside the same transaction as the source
 * record. Ledgers are isolated per centre — the same party can carry a
 * different balance in each centre.
 *
 * Note: running_balance is taken from the latest entry by (date, created_at),
 * so entries are assumed to be posted in roughly chronological order. Same-day
 * corrections keep later balances correct because purchase/payment pairs net
 * to zero.
 */
export async function postLedgerEntry(
  tx: Prisma.TransactionClient,
  args: PostLedgerArgs
) {
  const amount = new Prisma.Decimal(args.amount);
  const last = await tx.ledgerEntry.findFirst({
    where: {
      companyId: args.companyId,
      centreId: args.centreId,
      partyId: args.partyId,
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { runningBalance: true },
  });
  const prev = last?.runningBalance ?? new Prisma.Decimal(0);
  const runningBalance = prev.add(ledgerDelta(args.type, amount));

  return tx.ledgerEntry.create({
    data: {
      companyId: args.companyId,
      centreId: args.centreId,
      partyId: args.partyId,
      type: args.type,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      amount,
      date: args.date,
      runningBalance,
    },
  });
}

/** Current outstanding balance of a party within one (company, centre). */
export async function getPartyBalance(
  tx: Prisma.TransactionClient,
  companyId: string,
  centreId: string,
  partyId: string
): Promise<Prisma.Decimal> {
  const last = await tx.ledgerEntry.findFirst({
    where: { companyId, centreId, partyId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { runningBalance: true },
  });
  return last?.runningBalance ?? new Prisma.Decimal(0);
}
