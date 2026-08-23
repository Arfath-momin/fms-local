import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { PurchaseType, SaleType } from "@/generated/prisma/enums";

/**
 * Prefixes for the documents BFM issues itself.
 *
 * Only these four. A Society or KFDC purchase, and a factory, market or
 * fish-mill sale, all arrive with the counterparty's number printed on them —
 * inventing our own would lose the one they will quote back at us when there is
 * a query, which is the whole reason a bill number exists.
 */
export const SERIES_PREFIX = {
  DELIVERY_NOTE: "DN",
  PURCHASE_PRIVATE: "PP",
  PURCHASE_LOCAL: "LP",
  SALE_LOCAL: "LS",
} as const;

/** Whether this purchase type gets an auto number, and under which prefix. */
export function purchaseSeriesPrefix(type: PurchaseType): string | null {
  if (type === "PRIVATE") return SERIES_PREFIX.PURCHASE_PRIVATE;
  if (type === "LOCAL") return SERIES_PREFIX.PURCHASE_LOCAL;
  // Society and KFDC bills carry the society's own number.
  return null;
}

/** Whether this sale type gets an auto number, and under which prefix. */
export function saleSeriesPrefix(type: SaleType): string | null {
  if (type === "LOCAL") return SERIES_PREFIX.SALE_LOCAL;
  // Market, factory and fish mill all bill BFM with their own number.
  return null;
}

/** How a number reads: DN-00001. Five digits is a lifetime of documents. */
export function formatDocumentNo(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(5, "0")}`;
}

/**
 * Take the next number in a company's series, atomically.
 *
 * One statement, deliberately. Reading the counter and writing it back as two
 * steps — or computing max(bill_no) + 1 — lets two clerks saving at the same
 * moment both see the same value and both claim it. `ON CONFLICT DO UPDATE`
 * makes the read-modify-write a single row-locked operation, so the second
 * caller waits and gets the next number rather than a duplicate.
 *
 * MUST be called inside the voucher's own transaction: if the voucher then
 * fails, the number is rolled back with it rather than leaving a gap.
 */
export async function nextDocumentNo(
  tx: Prisma.TransactionClient,
  companyId: string,
  prefix: string
): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "document_series" ("id", "company_id", "prefix", "next")
    VALUES (gen_random_uuid(), ${companyId}, ${prefix}, 2)
    ON CONFLICT ("company_id", "prefix")
    DO UPDATE SET "next" = "document_series"."next" + 1
    RETURNING "next" - 1 AS "value"
  `;
  const value = rows[0]?.value;
  if (!value) throw new Error(`Could not allocate a ${prefix} number.`);
  return formatDocumentNo(prefix, value);
}

/**
 * What the next number in each series WOULD be, without taking it.
 *
 * A preview for the entry forms, so a clerk sees "DN-00004" rather than a
 * placeholder. Deliberately does not reserve: two people opening the form at
 * once both see the same number and only one gets it, which is why the real
 * allocation still happens inside the save. The forms say so.
 *
 * A series with no row yet has issued nothing, so it starts at 1.
 */
export async function peekDocumentNos(
  companyId: string,
  prefixes: string[]
): Promise<Record<string, string>> {
  const rows = await prisma.documentSeries.findMany({
    where: { companyId, prefix: { in: prefixes } },
    select: { prefix: true, next: true },
  });
  const byPrefix = new Map(rows.map((r) => [r.prefix, r.next]));
  return Object.fromEntries(
    prefixes.map((p) => [p, formatDocumentNo(p, byPrefix.get(p) ?? 1)])
  );
}
