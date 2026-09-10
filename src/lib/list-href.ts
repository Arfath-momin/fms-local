/**
 * URLs the list controls navigate to.
 *
 * Deliberately NOT in paging.ts, which is `server-only`: these are built inside
 * client components, and importing a runtime function out of a server-only
 * module pulls it into the browser bundle and takes the whole page down with a
 * 500. Types were fine to import from there — they are erased — which is why
 * this only became a problem the moment a function came with them.
 */

/**
 * Where the party filter goes when a party is chosen.
 *
 * Built from the id handed to the change handler, never read back out of the
 * form — that field still holds the previous choice at the moment of choosing,
 * which is how picking a party first produced "?party=" and a list filtered to
 * nobody.
 *
 * An empty id means Everyone, and drops the key rather than sending it blank,
 * so the URL says what it means.
 */
export function partyFilterHref(
  basePath: string,
  w: { from: string; to: string },
  partyId: string
): string {
  const qs = new URLSearchParams({ from: w.from, to: w.to });
  if (partyId) qs.set("party", partyId);
  return `${basePath}?${qs.toString()}`;
}
