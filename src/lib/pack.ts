import type { PackType } from "@/generated/prisma/enums";

/**
 * How a line is packed — the merchant's own three words.
 *
 * Deliberately NOT `server-only`: the entry forms pick it and the server
 * validates it, and both have to agree about what LOOSE means.
 */

export const PACK_TYPES: PackType[] = ["BOX", "BIG_BOX", "LOOSE"];

export const PACK_LABELS: Record<PackType, string> = {
  BOX: "Box",
  BIG_BOX: "Big Box",
  LOOSE: "Loose",
};

/**
 * Whether this line has crates that go out and come back.
 *
 * A BIG_BOX is still a crate — heavier fish, two kilos apiece, but it leaves on
 * the truck and returns like any other. LOOSE is fish too big to box: it goes
 * straight onto the truck bed, so there is nothing to send and nothing to
 * return, and counting it as zero crates would make a day appear to balance
 * when a third of the load was never in a crate at all.
 */
export const packsInCrates = (pack: PackType): boolean => pack !== "LOOSE";

/** The crates on a line, which is none at all when it is loose. */
export function crateCount(line: {
  pack: PackType;
  box?: number | null;
}): number {
  return packsInCrates(line.pack) ? (line.box ?? 0) : 0;
}
