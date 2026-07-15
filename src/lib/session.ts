import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";

const COOKIE_NAME = "fms_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type Session = {
  userId: string;
  email: string;
  name: string;
  role: Role;
};

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function createSession(session: Session) {
  const token = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify<Session>(token, secret());
    return {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

/** For pages/layouts: bounce to /login when unauthenticated. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * For mutating server actions: AUDITOR is read-only everywhere (spec §3.8),
 * so every write path must pass through this.
 */
export async function requireMerchant(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "MERCHANT") {
    throw new Error("Read-only account: auditors cannot make entries.");
  }
  return session;
}

export async function destroySession() {
  (await cookies()).delete(COOKIE_NAME);
}
