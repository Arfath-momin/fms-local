// Company identity — the colour behind the band and the switcher chip.
//
// Deliberately NOT `server-only`: the company form is a Client Component and
// must offer the same palette the server validates against. Keeping one list
// here is what stops the picker and the check drifting apart.

/** Fallback when a company has no colour of its own. Matches globals.css. */
export const DEFAULT_COMPANY_COLOUR = "#1e4d8c";

/**
 * The colours a company may be given.
 *
 * A fixed palette rather than a free colour picker, for two reasons. Company
 * ink is white everywhere it is used, so a light choice would produce a band
 * nobody can read — every colour here is dark enough to carry white text. And
 * the point of the colour is telling two companies apart at a glance, which a
 * palette of deliberately distant hues does better than whatever two neighbours
 * someone happens to pick.
 */
export const COMPANY_COLOURS: { value: string; label: string }[] = [
  { value: "#1e4d8c", label: "Deep blue" },
  { value: "#7a4a12", label: "Amber brown" },
  { value: "#1a6b45", label: "Forest green" },
  { value: "#6b2145", label: "Plum" },
  { value: "#14524f", label: "Teal" },
  { value: "#7a2418", label: "Rust" },
  { value: "#3d3a6b", label: "Indigo" },
  { value: "#4a4a4a", label: "Slate" },
];

export const isCompanyColour = (v: string): boolean =>
  COMPANY_COLOURS.some((c) => c.value === v);

/**
 * The next unused colour, so a newly added company is distinct from the
 * existing ones without anyone having to think about it. Falls back to cycling
 * once every colour is taken — at nine companies "distinct at a glance" has
 * stopped being achievable by colour alone anyway.
 */
export function suggestCompanyColour(taken: (string | null)[]): string {
  const used = new Set(taken.filter(Boolean));
  const free = COMPANY_COLOURS.find((c) => !used.has(c.value));
  return (free ?? COMPANY_COLOURS[used.size % COMPANY_COLOURS.length]).value;
}

/** What a document's letterhead calls this company. */
export const companyDisplayName = (c: {
  name: string;
  legalName?: string | null;
}) => c.legalName?.trim() || c.name;
