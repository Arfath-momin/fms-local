import type { PurchaseType } from "@/generated/prisma/enums";

export const PURCHASE_TYPE_LABELS: Record<PurchaseType, string> = {
  SOCIETY: "Society",
  KFDC: "KFDC",
  PRIVATE: "Private",
  LOCAL: "Local",
};

export const PURCHASE_TYPES = Object.keys(
  PURCHASE_TYPE_LABELS
) as PurchaseType[];
