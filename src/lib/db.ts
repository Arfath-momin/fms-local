import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Fail loudly, at import, when the database is not configured.
 *
 * `process.env.DATABASE_URL!` was a lie the type system could not catch. With
 * the variable unset, PrismaPg receives `undefined`, falls back to libpq's
 * defaults, and the app starts perfectly happily — then every query dies with
 * `DatabaseNotReachable 127.0.0.1:5432`, which reads like a database outage
 * rather than a missing setting. Worse in production: the Docker healthcheck
 * fetches /login, which renders without touching Postgres, so the container is
 * reported HEALTHY while every real request 500s. Throwing here turns a
 * mystery into a one-line startup failure naming the variable.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The app cannot start without it — set it in " +
        ".env for local work, or in the environment of the deployed service."
    );
  }
  return url;
}

const createClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionString() }),
  });

// Reuse a single client across dev hot reloads.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
