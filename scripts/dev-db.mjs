// Local development database — embedded PostgreSQL, no system install needed.
// Usage: `npm run db:dev` (keep it running while developing).
// Production ignores this entirely: point DATABASE_URL at the real Postgres.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(import.meta.dirname, "..", ".pgdata");
const PORT = 5502;
const DB_NAME = "fms";

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "fms",
  password: "fms",
  port: PORT,
  persistent: true,
});

const freshInit = !existsSync(path.join(DATA_DIR, "PG_VERSION"));
if (freshInit) {
  console.log(`Initialising Postgres data dir at ${DATA_DIR} ...`);
  await pg.initialise();
}

await pg.start();
if (freshInit) {
  await pg.createDatabase(DB_NAME);
}
console.log(
  `Postgres running: postgresql://fms:fms@localhost:${PORT}/${DB_NAME}`
);
console.log("Press Ctrl+C to stop.");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log("Stopping Postgres ...");
    await pg.stop();
    process.exit(0);
  });
}
