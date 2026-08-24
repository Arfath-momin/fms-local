import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetLoginThrottle,
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-throttle";

/**
 * Sign-in throttling.
 *
 * Worth testing rather than eyeballing because the failure mode is silent in
 * both directions: too loose and the only factor protecting the books is a
 * password someone can guess at leisure; too tight and a clerk who fat-fingers
 * their password twice is locked out of the day's entries. Neither shows up
 * until it happens to someone.
 */

const IP = "203.0.113.10";

beforeEach(() => {
  __resetLoginThrottle();
});

describe("per-account lockout", () => {
  it("allows the first attempts, then stops answering", () => {
    for (let i = 0; i < 4; i++) {
      expect(checkLoginAllowed("clerk@bfm.test", IP).ok).toBe(true);
      recordLoginFailure("clerk@bfm.test", IP);
    }
    // Four wrong guesses is a bad morning, not an attack.
    expect(checkLoginAllowed("clerk@bfm.test", IP).ok).toBe(true);

    recordLoginFailure("clerk@bfm.test", IP);
    const verdict = checkLoginAllowed("clerk@bfm.test", IP);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.retryAfterSec).toBeGreaterThan(0);
  });

  it("locks only the account being guessed at", () => {
    for (let i = 0; i < 5; i++) recordLoginFailure("clerk@bfm.test", IP);

    expect(checkLoginAllowed("clerk@bfm.test", IP).ok).toBe(false);
    // A different person at a different address is unaffected.
    expect(checkLoginAllowed("owner@bfm.test", "198.51.100.7").ok).toBe(true);
  });

  it("clears the account counter on a successful sign-in", () => {
    for (let i = 0; i < 4; i++) recordLoginFailure("clerk@bfm.test", IP);
    recordLoginSuccess("clerk@bfm.test");

    // Back to a clean slate: four more failures must not trip the limit.
    for (let i = 0; i < 4; i++) {
      expect(checkLoginAllowed("clerk@bfm.test", IP).ok).toBe(true);
      recordLoginFailure("clerk@bfm.test", IP);
    }
  });

  it("does not let one success wipe the address's record", () => {
    // Spraying: 19 different accounts tried from one place, one of them right.
    for (let i = 0; i < 19; i++) recordLoginFailure(`u${i}@bfm.test`, IP);
    recordLoginSuccess("u3@bfm.test");

    // The address is one failure from its limit, and the success must not have
    // reset that — otherwise a sprayer with one valid account sprays forever.
    recordLoginFailure("u99@bfm.test", IP);
    expect(checkLoginAllowed("someone-else@bfm.test", IP).ok).toBe(false);
  });
});

describe("per-address limit", () => {
  it("catches spraying that never trips a per-account limit", () => {
    // Four guesses each against five accounts: under the per-account limit of
    // 5 every time, so only the address counter can see what is happening.
    for (let account = 0; account < 5; account++) {
      for (let i = 0; i < 4; i++) {
        recordLoginFailure(`victim${account}@bfm.test`, IP);
      }
      expect(checkLoginAllowed(`victim${account}@bfm.test`, IP).ok).toBe(
        account < 4
      );
    }
    // 20 failures from one address: it stops answering for anyone.
    expect(checkLoginAllowed("brand-new@bfm.test", IP).ok).toBe(false);
  });
});

describe("backoff", () => {
  it("makes each extra failure past the limit cost more", () => {
    for (let i = 0; i < 5; i++) recordLoginFailure("clerk@bfm.test", IP);
    const first = checkLoginAllowed("clerk@bfm.test", IP);

    for (let i = 0; i < 3; i++) recordLoginFailure("clerk@bfm.test", IP);
    const later = checkLoginAllowed("clerk@bfm.test", IP);

    expect(first.ok).toBe(false);
    expect(later.ok).toBe(false);
    if (!first.ok && !later.ok) {
      expect(later.retryAfterSec).toBeGreaterThan(first.retryAfterSec);
    }
  });

  it("never asks a locked-out clerk to wait more than the window", () => {
    // A script that keeps hammering must not be able to push the wait to hours.
    for (let i = 0; i < 60; i++) recordLoginFailure("clerk@bfm.test", IP);
    const verdict = checkLoginAllowed("clerk@bfm.test", IP);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.retryAfterSec).toBeLessThanOrEqual(15 * 60);
  });
});
