import type { DeliveryStatus } from "@/generated/prisma/enums";

const STYLES: Record<DeliveryStatus, { label: string; cls: string }> = {
  PENDING: {
    label: "Pending",
    cls: "bg-[#fdf3e3] text-[#8a5a00] border-[#e0c894]",
  },
  SETTLED: {
    label: "Settled",
    cls: "bg-[#e7f2ec] text-credit border-[#b2d4c2]",
  },
};

export function StatusBadge({ status }: { status: DeliveryStatus }) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/** Whole days between a voucher date and now (UTC dates). */
export function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}
