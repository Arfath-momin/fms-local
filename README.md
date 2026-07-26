# FMS

Ledger application for fish-market trading — Purchase / Expense / Sale vouchers
per (company, centre), with auto-built running ledgers per party.

Runs entirely on the local machine: no hosted database, no image CDN, no cloud
account of any kind.

## Stack

- **Next.js 16** (App Router, Server Actions) + React 19 + Tailwind 4
- **PostgreSQL** via Prisma 7 — `embedded-postgres` locally, a real Postgres in production
- **Local filesystem** for bill/receipt images (`UPLOADS_DIR`)
- **Own JWT sessions** (`jose`) + `bcryptjs` — no external auth provider

## Running locally

Everything below runs offline. Requires Node 20+ only — Postgres is downloaded
and managed by `npm run db:dev`, nothing is installed system-wide.

```bash
npm install
```

Copy the environment defaults if `.env` is missing (it is gitignored):

```
DATABASE_URL="postgresql://fms:fms@localhost:5502/fms"
SESSION_SECRET="<node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\">"
UPLOADS_DIR="uploads"
```

Then, in **two terminals**:

```bash
npm run db:dev      # terminal 1 — keep running, this is the database
```

```bash
npm run db:migrate  # terminal 2 — apply migrations (first run only)
npm run db:seed     # load sample companies, centres, users, vouchers
npm run dev         # http://localhost:3000
```

The seed creates one login per role:

| Email | Password | Role |
|---|---|---|
| `admin@fms.local` | `admin123` | Admin — full access, only role that can edit a saved voucher |
| `accountant@fms.local` | `accountant123` | Accountant — enters vouchers and parties, cannot edit |
| `auditor@fms.local` | `auditor123` | Auditor / CA — read-only, no voucher menu |

### Local data

Two directories hold all local state, both gitignored:

| Path      | Contents                                        |
| --------- | ----------------------------------------------- |
| `.pgdata` | The Postgres cluster created by `npm run db:dev` |
| `uploads` | Bill/receipt images, sharded as `YYYY/MM/<uuid>.<ext>` |

Deleting `.pgdata` resets the database (re-run migrate + seed). Deleting
`uploads` permanently loses attached bill images — there is no remote copy.

## Attachments

Images are written under `UPLOADS_DIR` and served only through
`/api/attachments/[id]`, which checks the session before reading from disk. The
`attachments.storage_key` column holds a path *relative* to `UPLOADS_DIR`, so
the store can be moved or restored without touching the database.

Format is determined by sniffing the file's magic bytes at upload, not from the
browser-supplied MIME type, and the download route derives its `Content-Type`
from that verified extension.

## Time zone

Every "today" decision runs on India time (Asia/Kolkata) via `businessToday()`
in [`src/lib/format.ts`](src/lib/format.ts). Do not use `new Date()` or
`toISOString()` for this — both answer in UTC and are a day behind between
midnight and 05:30 IST.

## Deploying to a VPS

**For a full step-by-step walkthrough — server hardening, DNS, TLS, backups and
restore — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).** The summary below
assumes you already know your way around a server.

Four containers: the app (Next.js standalone build), Postgres, Caddy for TLS,
and a one-shot migration job. No external services.

```bash
git clone <repo> /srv/fms && cd /srv/fms
cp .env.example .env
```

Fill in `.env` — `SESSION_SECRET`, `POSTGRES_PASSWORD`, and `FMS_DOMAIN` have no
defaults and compose refuses to start without them. Point the domain's DNS at
the server first, or Caddy cannot obtain a certificate.

```bash
docker compose up -d --build
docker compose --profile seed run --rm seed   # first deploy only
```

The `migrate` service runs `prisma migrate deploy` and must exit successfully
before the app starts, so a failed migration blocks the rollout rather than
leaving the app running against a half-migrated schema.

To update:

```bash
git pull && docker compose up -d --build
```

### Notes

- **`DATABASE_URL` is derived from the Postgres service inside
  `docker-compose.yml`**, not read from `.env`, so the local-dev value pointing
  at `localhost:5502` cannot leak into the deployment.
- **Postgres publishes no ports.** It is reachable only on the compose network.
- **TLS is mandatory**, not cosmetic: session cookies are `secure` in
  production, so sign-in silently fails over plain HTTP.
- **Caddy's body limit (11 MB) must stay at or above
  `serverActions.bodySizeLimit`** in `next.config.ts`, or bill photos are
  rejected before Next sees them.
- **Two named volumes hold all persistent state**: `fms_pgdata` and
  `fms_uploads`. Both survive `docker compose down`; `down -v` destroys them.
- `embedded-postgres` and `scripts/dev-db.mjs` are development-only and are
  never used in the container.

### Backups

`scripts/backup.sh` dumps the database and archives the uploads volume, keeping
30 days. Nothing else holds a copy of either — once real entries exist this is
not optional.

```
0 2 * * * /srv/fms/scripts/backup.sh >> /var/log/fms-backup.log 2>&1
```

Copy the output off the machine. A backup on the same disk is not a backup.

## Scripts

| Command              | Purpose                                     |
| -------------------- | ------------------------------------------- |
| `npm run dev`        | Development server                          |
| `npm run build`      | Production build                            |
| `npm run start`      | Serve a production build                    |
| `npm run lint`       | ESLint                                      |
| `npm run db:dev`     | Start the local embedded Postgres           |
| `npm run db:migrate` | Apply migrations (`prisma migrate dev`)     |
| `npm run db:seed`    | Reset transactional data and load samples   |
| `npm run db:studio`  | Browse/edit tables in the browser           |
| `npm run db:check`   | Print every ledger entry with running balances |
| `npm run user:create`| Create or update a login account (safe on production) |

## Roles

| Role | Vouchers | Parties | Users | Notes |
|---|---|---|---|---|
| **Admin** | create + edit | create + edit | manage | The only role that can change a voucher after it is saved. |
| **Accountant** | create only | create + edit | — | Entry cannot be edited once saved; ask an admin. |
| **Auditor / CA** | read-only | — | — | Ledgers and reports; opens vouchers read-only from a ledger. No voucher menu. |

Enforced in two places that read the same predicates in [`src/lib/session.ts`](src/lib/session.ts):
`requireEntry()` / `requireAdmin()` guard every server action, and
`canEnter()` / `canEdit()` / `canAdminister()` hide the matching UI, so a
hidden button and a rejected action can never disagree.

Sessions re-read the account from the database on every request, so a role
change or a deactivation takes effect immediately rather than when the
seven-day cookie expires.

Every voucher records who entered it and who last edited it, shown at the foot
of its detail page.

### Accounts

`db:seed` is a **development tool**: it uses passwords hardcoded in this repo
and deletes all transactional data first. Never run it against production. To
manage real accounts, use:

```bash
npm run user:create -- --email you@example.com --name "You" --role ADMIN
npm run user:create -- --email you@example.com --role AUDITOR --update
```

Omit `--password` and a strong one is generated and printed once. In production this is only needed for the *first* admin — after that, use the
**Users** screen in the app.

### Inspecting the database

`npm run db:dev` must be running first — everything else connects to it.

```bash
npm run db:studio   # http://localhost:5555, all tables, editable
npm run db:check    # ledger entries + running balances, as text
```

No `psql` is bundled: `embedded-postgres` ships only `initdb`, `pg_ctl`, and
`postgres`. For ad-hoc SQL, either install the Postgres client tools separately
and connect to `postgresql://fms:fms@localhost:5502/fms`, or use Studio.
