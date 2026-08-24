"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, landingPathFor } from "@/lib/session";
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-throttle";

export type LoginState = { error: string } | null;

/**
 * A bcrypt hash of a value nobody can supply, compared against when the email
 * is unknown.
 *
 * Without it the two failure paths cost wildly different amounts of time: a
 * real account runs bcrypt at the app's cost of 12 (~300ms), an invented one
 * returns as fast as the query. That difference is measurable over a handful of
 * requests, which turns the login form into a directory of who holds an account
 * here — and this is a business whose staff emails are on every bill it issues.
 * Comparing against a fixed hash makes both paths pay the same.
 *
 * Hashed at cost 12 to match BCRYPT_COST in the user admin, over a random
 * string no password can be.
 */
const DUMMY_HASH = "$2b$12$lwJvj2RiHSkvWzOGZxOjSuNSxSxFUWewR/GM2GwQNhGfytHVryCyK";

/**
 * The caller's address, for throttling. Caddy sets X-Forwarded-For and is the
 * only thing that can reach the app — no `ports:` is published for it — so the
 * left-most entry is the real client rather than something a client chose.
 * Falls back to a constant, which fails safe: an unknown address shares one
 * bucket and so throttles harder, never softer.
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const ip = await clientIp();

  const allowed = checkLoginAllowed(email, ip);
  if (!allowed.ok) {
    const mins = Math.ceil(allowed.retryAfterSec / 60);
    return {
      error:
        `Too many failed sign-in attempts. Try again in ` +
        `${mins} minute${mins === 1 ? "" : "s"}.`,
    };
  }

  let landing: string;
  try {
    const user = await prisma.user.findUnique({ where: { email } });

    // Always run the comparison, even with no user, so an unknown email and a
    // wrong password take the same time. See DUMMY_HASH above.
    const passwordOk = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_HASH
    );

    if (!user || !passwordOk) {
      recordLoginFailure(email, ip);
      return { error: "Email or password is incorrect." };
    }
    // Checked after the password so a wrong guess cannot reveal which accounts
    // exist but are switched off.
    if (!user.isActive) {
      // Counted too: a deactivated account is still an account being guessed at.
      recordLoginFailure(email, ip);
      return { error: "This account has been deactivated. Ask an administrator." };
    }

    recordLoginSuccess(email);
    await createSession({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    landing = landingPathFor(user.role);
  } catch (error) {
    console.error("Login error:", error);
    return { error: "Unable to connect to the database. Please try again." };
  }

  // Outside the try: redirect() signals by throwing, so calling it inside
  // would be caught by the handler above and reported as a database failure.
  redirect(landing);
}
