"use client";

import { lotLabel, OVERHEAD_LOT_LABEL, type LotOption } from "@/lib/lot";

export type { LotOption };

/**
 * Which consignment a sale or expense belongs to.
 *
 * This is the field that makes per-lot profit possible, and it is the one field
 * on these forms whose default matters more than its options: fish sold today
 * almost always came from the newest open lot, so that is pre-selected and the
 * merchant scrolls past it. Selling Monday's fish on Wednesday is then one
 * change to one dropdown rather than a step they have to remember.
 *
 * The lot codes are dates — "15AUG26" — so the choice reads as "which day's
 * fish is this" without anyone having to learn a numbering scheme.
 */
export function LotField({
  lots,
  defaultValue,
  label = "Lot",
  className,
  labelClassName,
}: {
  lots: LotOption[];
  defaultValue?: string;
  label?: string;
  className?: string;
  labelClassName?: string;
}) {
  if (lots.length === 0) {
    return (
      <div>
        <span className={labelClassName}>{label}</span>
        <p className="text-debit text-[13px]">
          No lot is open in this centre. Enter the day&apos;s purchase first —
          that opens the lot this sale belongs to.
        </p>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="lotId" className={labelClassName}>
        {label}
      </label>
      <select
        id="lotId"
        name="lotId"
        required
        defaultValue={defaultValue}
        className={className}
      >
        {lots.map((l) => (
          <option key={l.id} value={l.id}>
            {lotLabel({ ...l, closedAt: l.closedAt ? new Date(l.closedAt) : null })}
          </option>
        ))}
      </select>
      <p className="text-muted text-[12px] mt-1">
        Which day&apos;s fish this is — its purchases, sales and costs are what
        make that lot&apos;s profit. Use{" "}
        <span className="font-medium">{OVERHEAD_LOT_LABEL}</span> for rent and
        other costs that belong to no single day.
      </p>
    </div>
  );
}
