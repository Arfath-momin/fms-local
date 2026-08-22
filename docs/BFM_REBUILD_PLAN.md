# BFM Rebuild Plan

_Execution plan. Read `BFM_DOMAIN_SPEC.md` first — it holds the rules; this holds
the order of work, the commands, and the gates._

---

## Before anything: the one safety check

**Does the VPS have real entries in it?**

`docs/DEPLOYMENT.md` describes a live deployment with `fms_pgdata` /
`fms_uploads` volumes and a four-hourly rclone backup to Google Drive. Squashing
migrations breaks `prisma migrate deploy` on any database that has already
applied them.

```bash
# on the VPS
docker compose exec -T postgres psql -U fms -d fms -c \
  "select 'purchases' t, count(*) from purchases
   union all select 'sales', count(*) from sales
   union all select 'expenses', count(*) from expenses;"
```

- **All zero, or all test data** → proceed with Phase 0 as written, and reset the
  server database the same way.
- **Anything real in there** → stop. Do not squash. Come back and re-plan the
  migration path.

Either way, take a backup first — it costs nothing:

```bash
# local
cp -r .pgdata .pgdata.bak-$(date +%F)
# VPS
docker compose exec -T postgres pg_dump -U fms fms | gzip > ~/fms-pre-rebuild.sql.gz
```

---

## Ground rules for the whole rebuild

1. **Branch per phase.** `git checkout -b rebuild/phase-1` etc. Merge only when
   the gate passes.
2. **Every phase ends green.** `npm run lint && npm run build` must both pass,
   and `npm run db:verify` must reconcile. A phase that leaves the tree red is
   not done.
3. **Add the money tests in Phase 0** (see below). They are the only thing that
   will tell you a later phase silently changed a figure.
4. **One concern per commit.** Schema change, then generated client, then server
   actions, then UI — not all in one.
5. **Do not rename what you do not have to.** `DeliveryNote` keeps its name and
   table. Renaming churns every route under `vouchers/deliveries` and
   `(print)/vouchers/deliveries` for zero benefit.

---

## Phase 0 — Reset the baseline

**Why now:** every entry in the database is test data. This window closes the day
real trading is entered, and everything after it is cheaper on a clean base.

```bash
git checkout -b rebuild/phase-0

# 1. wipe migrations and start one clean history
rm -rf prisma/migrations

# 2. edit prisma/schema.prisma to the target model in the spec, §3
#    — including the §3.7 deletions

# 3. reset the local database and generate a single init migration
npm run db:dev            # terminal 1, leave running
npx prisma migrate reset --force
npx prisma migrate dev --name init

# 4. update scripts/seed.ts for the new model, then
npm run db:seed
npm run db:verify
```

Also in this phase:

- **Add a test runner and the money tests.** There is none today, and the
  arithmetic in `lib/report.ts` and `lib/ledger.ts` is exactly the code that must
  not drift silently.

  ```bash
  npm i -D vitest
  # package.json → "test": "vitest run"
  ```

  Minimum coverage before Phase 1:
  - market revenue = net bill + rentDeducted
  - factory / mill revenue = bill amount, deductions rejected
  - transporter balance closes at zero for both rent flows
  - gross profit excludes overhead categories
  - running balance after a **back-dated** insert matches a full recompute

**Gate:** `npm run lint && npm run build && npm test && npm run db:verify`, one
migration in `prisma/migrations/`, seed loads clean.

---

## Phase 1 — Trip, vehicle, transporter

Spec §3.1, §3.2. Fixes **F1, F4**.

1. `Vehicle` model + `TRANSPORTER` party type. Masters screen to add vehicles
   with their transporter.
2. `DeliveryNote` gains `channel`, `vehicleId`, `rentAmount`, `advancePaid`,
   `status`, `cratesReturned`, `dispatchedOn`. `vehicleNo` string is removed.
3. Delivery-note form: vehicle becomes a **picker**, not free text. Channel is
   chosen. Rent is entered. Advance only shows for MARKET.
4. On save, post to the transporter's ledger: `RENT` credit for `rentAmount`, and
   a `PAYMENT` debit for the advance if there is one.
5. Rent posts as a **DIRECT expense** dated to the trip's buying day — exactly
   once, from the trip. No separate rent expense voucher.

**Gate:** create a market trip and a factory trip; both transporter ledgers show
the right credits; the day's expense total includes each rent exactly once.

---

## Phase 2 — Bills point back at their truck

Spec §3.3. Fixes **F3, F6, F7, F14**.

1. `Sale.deliveryNoteId` + `carriesRent` + `rentDeducted` + `otherDeduction`.
2. Sale form: a trip picker filtered to the same company, centre, buying day and
   channel. Sale `date` is copied from the trip, not typed.
3. Market sale lines gain box counts. Factory lines carry accepted kilos.
4. `carriesRent` on the last market bill posts the `RENT_BY_PARTY` pair (spec §2).
   Enforce one-per-trip and the cap.
5. **Trip reconciliation view** — one screen serving both tallies:
   - market: boxes dispatched vs boxes billed vs crates returned
   - factory: kilos dispatched vs kilos accepted, gap valued
6. Trip status moves DISPATCHED → PART_BILLED → CLOSED as bills arrive.

**Gate:** a three-market trip with 100 boxes tallies to 100 and closes; a factory
trip with a 40 kg rejection shows the gap and its value.

---

## Phase 3 — The money truth

Spec §2, §3.5, §3.6. Fixes **F2, F5**.

1. Stop posting `COMMISSION` and `RESERVE` ledger entries. Retire both standing
   parties.
2. Move the deduction block onto the market form alone. Factory, mill and local
   forms lose commission, reserve and the deduction fields entirely.
3. `ReserveCollection` model + voucher. Derived reserve balance per market party,
   with a screen listing who holds how much.
4. Rewrite revenue in `lib/report.ts` and `lib/sale.ts` to the §2 rules.
5. Rebuild the profit report on it.

**Gate:** the worked example reconciles. Enter the 16 Aug day from the audit
(₹1,85,000 purchase, ₹15,000 direct, three trucks at ₹20,000 / ₹8,000 / ₹4,000,
market bills totalling ₹1,80,000, factory ₹70,000, mill ₹25,000) and the gross
profit must read **₹31,400**, with ₹6,000 of reserve outstanding across three
market parties.

---

## Phase 4 — Expenses

Spec §3.4. Fixes **F8, F9, F10**.

1. `ExpenseCategory` master + `ExpenseLine`. Drop the enum, migrate
   `Expense.category` → `categoryId`. Make `partyId` optional.
2. Seed the categories: ICE, LOADERS, LADIES, BATHA, CANTEEN, RENT as **DIRECT**;
   SALARY, OFFICE_RENT, OTHER as **OVERHEAD** with `allowsLines` on OTHER.
3. Expense form renders a name/amount line table when `allowsLines`, summing into
   `amount`.
4. Two-tier profit report: gross per buying day, net per month after overheads
   and plus reserve collected.

**Gate:** a month-end salary voucher does not move any buying day's gross profit,
and appears in the month's net profit.

---

## Phase 5 — Guards and reports

Fixes **F11, F12, F13**.

1. Soft warning on sale entry when the buying day has no purchase at that centre.
2. **Open trips** worklist on the dashboard — dispatched trips with unbilled
   boxes, oldest first. This is the screen worth having every morning.
3. Company-level outstanding, consolidating a party across centres.
4. Society payment advice: unpaid purchases grouped by bill and boat. A reference
   sheet, not an allocation — settlement stays on the running balance.

**Gate:** a trip with a missing bill appears on the dashboard within a day.

---

## Performance — verify these while you are in the code

I could not read `src/lib` before writing this, so treat the list as a checklist
to confirm, not findings. In rough order of likely impact:

1. **Running-balance recompute scope.** Bills arriving 2–3 days late mean
   back-dated ledger inserts are the *normal* case, not the exception. Confirm
   the recompute is scoped to one `(companyId, centreId, partyId)` from the
   affected date forward — the `[companyId, centreId, partyId, date, seq]` index
   supports exactly that. If it recomputes the whole table, this is the single
   biggest cost in the app and it grows forever.

2. **N+1 on list pages.** Voucher lists, ledger lists and the register render
   party, centre and attachment data per row. Confirm each list is one query with
   `select`, not a query per row. Check `vouchers/*/page.tsx`,
   `ledgers/*/page.tsx`, `reports/register/page.tsx` (18 KB — most likely
   offender).

3. **Sequential awaits in the reports.** `lib/report.ts` is 18 KB and spans
   purchases, sales, expenses and ledger over a date range. Batch independent
   queries with `Promise.all`, and prefer SQL `SUM`/`GROUP BY` over fetching rows
   and reducing in JS.

4. **Decimal serialisation across the server/client boundary.** Prisma `Decimal`
   is not serialisable to client components. Converting per field per row is fine
   for 20 rows and painful for 2,000. Convert once in the query layer, or cast in
   SQL and select numbers.

5. **Indexes for the new work.** `sales(delivery_note_id)`,
   `delivery_notes(status)`, `delivery_notes(vehicle_id)`,
   `vehicles(company_id, number)`. All are in the spec — confirm they exist after
   Phase 2.

6. **Bill photo handling.** `sharp` is a dependency and the Server Action body
   limit is 11 MB. Confirm phone photos are resized server-side before being
   written to `UPLOADS_DIR`. If originals are stored at full size, disk and every
   subsequent download pay for it forever.

7. **Masters caching.** Companies, centres and expense categories change almost
   never and are read on every form. Cache them; invalidate on write. Parties are
   already handled correctly via `/api/parties/search` rather than loading the
   full list.

8. **`npm run build` timing.** Note it before and after. `src/generated/prisma` is
   large (`internal/class.ts` alone is 200 KB); if build time climbs badly,
   `typedSql` and generator options are worth a look — but measure first.

---

## Suggested order in VS Code

Say to Claude Code, one at a time:

```
Read docs/BFM_DOMAIN_SPEC.md and docs/BFM_REBUILD_PLAN.md, then do Phase 0.
Stop at the gate and show me the result.
```

Do not hand it two phases at once. Each gate is there because the next phase
assumes the previous one is actually correct.
