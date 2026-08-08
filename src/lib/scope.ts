/**
 * Scope pinning for entry forms — the client-safe half.
 *
 * The active company and centre live in cookies, so the scope an action sees is
 * whatever is set at the moment of submission, not what was on screen when the
 * form was drawn. Every entry form echoes the scope it was rendered under back
 * in these hidden fields; requireSubmittedScope() in lib/centre.ts (server-only)
 * compares them before anything is written.
 *
 * Field names are deliberately prefixed so they cannot collide with a real
 * voucher field, now or later.
 */

export const SCOPE_COMPANY_FIELD = "__scopeCompanyId";
export const SCOPE_CENTRE_FIELD = "__scopeCentreId";

/** The scope an entry form was rendered under. */
export type FormScope = { companyId: string; centreId: string };
