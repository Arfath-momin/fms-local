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
  // On some Windows machines Postgres cannot fork worker children — the
  // autovacuum worker dies with 0xC0000142 (STATUS_DLL_INIT_FAILED, usually a
  // security product injecting a DLL into the spawned child), which crashes the
  // whole cluster. Autovacuum is unnecessary for a tiny local dev DB, so turn it
  // off to keep the cluster stable. (Not a production setting — prod uses a real
  // Postgres and ignores this file entirely.)
  postgresFlags: ["-c", "autovacuum=off"],
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
