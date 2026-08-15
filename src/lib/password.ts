/**
 * The password floor, shared by the server actions that enforce it and the
 * forms that advertise it.
 *
 * Deliberately not in src/lib/session.ts: that module is server-only, and the
 * Users screen is a client component that needs this number to set `minLength`
 * and write the placeholder. Two copies of it drifted apart is exactly how a
 * form comes to promise one rule while the action applies another.
 */
export const MIN_PASSWORD_LENGTH = 12;
