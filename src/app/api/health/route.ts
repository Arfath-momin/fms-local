import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Never cached, never prerendered: a health probe that answers from a cache is
// worse than no probe at all.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Liveness probe for the container runtime.
 *
 * Exists because the previous probe fetched /login, which renders entirely from
 * the bundle — no database, no session secret. A container with a missing or
 * wrong DATABASE_URL therefore reported HEALTHY forever while every real
 * request returned 500, so nothing ever restarted it and nothing ever said why.
 *
 * This asks the two questions that decide whether the app can actually do its
 * job: does a query reach Postgres, and is the cookie signing key configured.
 *
 * Deliberately unauthenticated — the runtime probing it holds no session — and
 * deliberately mute about detail. The body is "ok" or "unhealthy" and the
 * reason goes to the container log, where an operator can read it and a passer
 * by cannot. It exposes no schema, no version and no counts.
 */
export async function GET() {
  if (!process.env.SESSION_SECRET) {
    console.error("Health check failed: SESSION_SECRET is not set.");
    return new NextResponse("unhealthy", { status: 503 });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    console.error("Health check failed: database unreachable.", e);
    return new NextResponse("unhealthy", { status: 503 });
  }

  return new NextResponse("ok", {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
