import "server-only";

/**
 * Failed–sign-in throttling.
 *
 * The app is on the public internet with a password as the only factor, and
 * nothing above it counted attempts: bcrypt's cost is the sole brake, which
 * still leaves a few hundred guesses a minute against an account whose email is
 * printed on every bill the business sends out. That is enough to walk a short
 * or reused password, and there would be no trace of it beyond the access log.
 *
 * Deliberately in-process. The alternative — a `login_attempts` table — buys
 * durability across restarts and correctness across replicas, and this
 * deployment has neither problem: one container behind Caddy, restarted only by
 * a deploy. An in-memory counter cannot be cleared by anyone who is not already
 * on the host, and it costs no query on the hot path. Revisit if the app is
 * ever scaled to more than one instance, at which point per-instance counters
 * would divide the real limit by the replica count.
 *
 * Two independent keys, because they answer different questions:
 *
 *   email  — is someone working on THIS account? Locks the account briefly.
 *   ip     — is someone working on the whole user list from one place?
 *            Catches spraying, which never trips a per-account limit.
 *
 * A success clears the account's counter but not the address's: one valid
 * login should not wipe the evidence of fifty failures around it.
 */

const WINDOW_MS = 15 * 60 * 1000;

/** Failures against one email before that account stops answering. */
const EMAIL_LIMIT = 5;

/** Failures from one address before it stops answering for any account. */
const IP_LIMIT = 20;

type Bucket = { count: number; first: number; until: number };

const buckets = new Map<string, Bucket>();

/**
 * Bounds the map so a spray across thousands of invented emails cannot grow it
 * without limit. Entries are tiny and expire on their own; this is the backstop
 * for the case where they arrive faster than they lapse.
 */
const MAX_BUCKETS = 10_000;

function sweep(now: number) {
  for (const [key, b] of buckets) {
    if (now - b.first > WINDOW_MS && now > b.until) buckets.delete(key);
  }
}

function bucketFor(key: string, now: number): Bucket {
  const existing = buckets.get(key);
  if (existing && now - existing.first <= WINDOW_MS) return existing;
  const fresh = { count: 0, first: now, until: 0 };
  if (buckets.size >= MAX_BUCKETS) sweep(now);
  buckets.set(key, fresh);
  return fresh;
}

/**
 * How long a key stays locked after tripping its limit. Doubles per extra
 * failure so a script that keeps hammering backs off by itself, capped at the
 * window so a locked-out clerk is never told to wait an hour.
 */
function lockoutMs(count: number, limit: number): number {
  const over = count - limit;
  return Math.min(WINDOW_MS, 60_000 * 2 ** Math.max(0, over));
}

export type ThrottleVerdict = { ok: true } | { ok: false; retryAfterSec: number };

/** Checked before the password is looked at. */
export function checkLoginAllowed(email: string, ip: string): ThrottleVerdict {
  const now = Date.now();
  for (const key of [`e:${email}`, `i:${ip}`]) {
    const b = buckets.get(key);
    if (b && now < b.until) {
      return { ok: false, retryAfterSec: Math.ceil((b.until - now) / 1000) };
    }
  }
  return { ok: true };
}

/** Called on every rejected attempt, whatever the reason. */
export function recordLoginFailure(email: string, ip: string): void {
  const now = Date.now();
  for (const [key, limit] of [
    [`e:${email}`, EMAIL_LIMIT],
    [`i:${ip}`, IP_LIMIT],
  ] as const) {
    const b = bucketFor(key, now);
    b.count += 1;
    if (b.count >= limit) b.until = now + lockoutMs(b.count, limit);
  }
}

/** Called on a successful sign-in. Clears the account, never the address. */
export function recordLoginSuccess(email: string): void {
  buckets.delete(`e:${email}`);
}

/** Test seam — there is no other way to get a clean slate in-process. */
export function __resetLoginThrottle(): void {
  buckets.clear();
}
