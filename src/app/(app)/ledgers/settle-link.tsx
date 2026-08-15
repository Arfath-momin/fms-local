import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import type { PartyType, SettlementKind } from "@/generated/prisma/enums";
import {
  SETTLEMENT_PARTY_TYPES,
  SETTLEMENT_PATH,
} from "@/lib/settlement";

/**
 * "Record receipt" / "Record payment" for one party, pointed at a voucher with
 * that party already filled in.
 *
 * Which of the two it offers is decided here rather than by the merchant. The
 * sign convention in src/lib/ledger.ts is that a positive balance means the
 * party owes us, so a positive balance can only be settled by collecting —
 * a receipt — and a negative one only by paying. Asking someone reading an
 * outstanding list to translate a sign into a voucher type is how a payment
 * gets entered against a debtor and pushes their balance further out.
 *
 * A settled party keeps the link, chosen from which side of the business they
 * are on instead, because a zero balance is exactly when an advance is paid.
 */
export function SettleLink({
  partyId,
  partyType,
  balance,
  className = "",
}: {
  partyId: string;
  partyType: PartyType;
  balance: Prisma.Decimal;
  className?: string;
}) {
  const kind = settlementKindFor(partyType, balance);
  if (!kind) return null;

  return (
    <Link
      href={`${SETTLEMENT_PATH[kind]}/new?partyId=${partyId}`}
      className={`text-accent underline underline-offset-2 whitespace-nowrap ${className}`}
    >
      {kind === "RECEIPT" ? "Record receipt" : "Record payment"}
    </Link>
  );
}

/**
 * The voucher that moves this balance toward zero, or null for a party neither
 * kind accepts — the Commission account, which is posted to by sales and never
 * settled by hand.
 */
export function settlementKindFor(
  partyType: PartyType,
  balance: Prisma.Decimal
): SettlementKind | null {
  const takes = (k: SettlementKind) =>
    SETTLEMENT_PARTY_TYPES[k].includes(partyType);

  if (balance.greaterThan(0) && takes("RECEIPT")) return "RECEIPT";
  if (balance.lessThan(0) && takes("PAYMENT")) return "PAYMENT";
  // Square, or a balance sitting on the side its party type does not settle —
  // fall back to whichever kind this party is eligible for at all.
  if (takes("RECEIPT")) return "RECEIPT";
  if (takes("PAYMENT")) return "PAYMENT";
  return null;
}
