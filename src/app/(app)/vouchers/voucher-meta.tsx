import { fmtDateTime } from "@/lib/format";

/**
 * Who entered a voucher and who last changed it. Rows created before the audit
 * trail existed have no author, so every field is optional and the whole strip
 * disappears rather than showing "Entered by —".
 */
export function VoucherMeta({
  createdBy,
  createdAt,
  updatedBy,
  updatedAt,
}: {
  createdBy?: { name: string } | null;
  createdAt: Date;
  updatedBy?: { name: string } | null;
  updatedAt?: Date | null;
}) {
  if (!createdBy && !updatedBy) return null;

  return (
    <p className="text-[12px] text-muted mt-4">
      {createdBy && (
        <>
          Entered by <span className="text-foreground">{createdBy.name}</span> on{" "}
          {fmtDateTime(createdAt)}
        </>
      )}
      {updatedBy && updatedAt && (
        <>
          {createdBy && " · "}
          Last edited by <span className="text-foreground">{updatedBy.name}</span> on{" "}
          {fmtDateTime(updatedAt)}
        </>
      )}
    </p>
  );
}
