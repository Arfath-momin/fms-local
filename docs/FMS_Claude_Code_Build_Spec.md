# FMS — Build Specification (for Claude Code)

Read this fully before writing any code. This is the engineering spec, derived from `FMS_Business_Rules_Decisions_Log.md` and `FMS_Flow_Walkthrough_v2_Delivery_Settlement.md` — those two documents explain *why*; this document tells you *what to build*. If anything here seems to conflict with them, this file is what to implement, but flag the conflict.

---

## 1. Tech Stack

- **Frontend/Backend:** Next.js (App Router), deployed to Hostinger Business via their Node.js Web Apps feature.
- **Database:** PostgreSQL (recommended default — better JSON/enum support for the ledger-heavy schema below). MySQL is a viable fallback since Hostinger supports it natively; **confirm before scaffolding migrations**, since switching after real data exists is painful.
- **ORM:** Prisma (or Drizzle) — either works; pick one and stay consistent.
- **Primary keys: UUIDs, generated client-side, on every table — not database auto-increment.** This costs nothing for the online-only V1, but keeps the door open for offline support later (local-save + background sync) without a painful ID migration once real production data exists. Non-negotiable — apply this from the very first migration.
- **File storage:** local disk under Hostinger's storage (well within 50GB) for receipt/bill image attachments only. Reports/statements generate in-memory and stream to the client — never persisted server-side.
- **Auth:** simple email/password or magic-link, two roles: `MERCHANT` (full access), `AUDITOR` (read-only).

## 2. Core Entities

### `Company`
- `id`, `name` (BFM / B2B), `created_at`
- Everything below is scoped by `company_id`. No cross-company queries except the Party master (see below).

### `Party`
- `id`, `name`, `type` (enum: `SOCIETY`, `PRIVATE_SELLER`, `BOAT`, `MARKET_BUYER`, `FACTORY`, `FISH_MILL`, `LOCAL_BUYER`), `contact_info`
- **Global, not company-scoped** — shared across BFM and B2B.
- Ledger balances are derived per-company (see `LedgerEntry` below), never stored directly on `Party`.

### `Purchase`
- `id`, `company_id`, `party_id`, `type` (enum: `SOCIETY`, `PRIVATE`, `LOCAL`), `invoice_number` (required; auto-generate `LOC-AUTO-####` sequence per company if type=LOCAL and none provided), `fish_type`, `qty_kg`, `amount`, `date`
- On save: creates a `StockMovement` record (`direction: IN`, `state: AVAILABLE`) and a `LedgerEntry` against the party (paid same day by default — no advance/credit modeling per decisions log §2).

### `StockMovement` (the entry-exit-balance ledger)
- `id`, `company_id`, `fish_type`, `qty_kg`, `state` (enum: `AVAILABLE`, `IN_TRANSIT`, `SOLD`, `LOSS`), `source_type` (`PURCHASE`, `DELIVERY`, `SETTLEMENT_RETURN`, `LOSS_WRITEOFF`), `source_id`, `date`
- This table is the single source of truth for inventory. "Available stock" for a fish type = `SUM(qty_kg WHERE state = AVAILABLE)`. No separate `Inventory` table needed — it's always a live query over this ledger.
- **Reconciliation invariant to enforce in code (not just reporting):** for any fish type, `SUM(AVAILABLE) + SUM(IN_TRANSIT) + SUM(SOLD) + SUM(LOSS) = SUM(all PURCHASE qty)`. Consider a periodic integrity check job or at minimum a reconciliation report screen — do not let this silently drift.

### `DeliveryNote`
- `id`, `company_id`, `party_id` (buyer), `channel` (enum: `FACTORY`, `MARKET`, `FISH_MILL`, `LOCAL_SALE`), `fish_type`, `qty_sent`, `rate` (locked at creation), `expected_value`, `date`, `status` (`PENDING`, `PARTIALLY_SETTLED`, `SETTLED`)
- On save: `StockMovement` qty_sent moves from `AVAILABLE` → `IN_TRANSIT`.
- `LOCAL_SALE` channel may skip this entirely — see `DirectSale` below.

### `Settlement`
- `id`, `delivery_note_id`, `qty_accepted`, `qty_returned`, `qty_spoiled` (complete loss — does NOT return to Available), `amount_received`, `date`
- **Supports multiple partial settlements per delivery note** (decisions log §4) — a `DeliveryNote` isn't `SETTLED` until `SUM(qty_accepted + qty_returned + qty_spoiled)` across all its settlements equals `qty_sent`.
- On save:
  - `qty_accepted` → `StockMovement` state `IN_TRANSIT` → `SOLD`; posts a `LedgerEntry` (revenue) against the party.
  - `qty_returned` → `StockMovement` state `IN_TRANSIT` → `AVAILABLE` (re-routable).
  - `qty_spoiled` → `StockMovement` state `IN_TRANSIT` → `LOSS` (permanent, does not return to stock).
  - **Price variance check:** if `qty_accepted == qty_sent` (no quantity dispute) but `amount_received != qty_accepted * rate`, the shortfall posts as a running debt on the party's ledger (`LedgerEntry` type `PRICE_VARIANCE`), and must be surfaced prominently — see §5.
  - Channel-specific deduction handling:
    - `FACTORY`: `amount_received` is the full paid amount, no deductions.
    - `MARKET`: enter `gross`, `commission` (reference only, not calculated), `owner_reserve` (as billed) as separate input fields. `amount_received` = net as billed. `owner_reserve` also posts a credit to the singleton `OwnerReserveAccount` (see below).
    - `FISH_MILL`, `LOCAL_SALE`: default zero deductions, but allow the same commission/reserve fields if a mill ever charges one — don't hardcode zero, just default it.

### `DirectSale` (Local Sale quick path only)
- `id`, `company_id`, `party_id`, `fish_type`, `qty_kg`, `rate`, `amount`, `date`
- Single-step: `StockMovement` `AVAILABLE` → `SOLD` immediately, `LedgerEntry` posted immediately. No delivery/settlement split.

### `OwnerReserveAccount`
- One running balance per company. Every `Settlement` with a non-zero `owner_reserve` value adds a `OwnerReserveEntry` (`id`, `company_id`, `settlement_id`, `amount`, `date`, `running_balance`).
- Simple append-only ledger; balance = sum of all entries (support a manual withdrawal/adjustment entry type later if needed, out of scope for V1 unless requested).

### `Expense`
- `id`, `company_id`, `category` (enum: `LOADERS`, `WORKERS`, `ICE`, `CANTEEN`, `RENT`, `TRANSPORT`, `FUEL`, `MISC`), `amount`, `date`, `notes`
- Each category behaves as its own mini ledger (group by category for category-level statements).

### `LedgerEntry` (generic, powers every party statement)
- `id`, `company_id`, `party_id`, `type` (`DEBIT`/`CREDIT`), `source_type` (`PURCHASE`, `SALE`, `SETTLEMENT`, `PRICE_VARIANCE`, `PAYMENT`), `source_id`, `amount`, `date`, `running_balance`
- Every party statement/ledger view is just a filtered, ordered query over this table. Don't build separate ledger tables per party type — one generic table, filtered by `party_id` and `company_id`.

### `Attachment`
- `id`, `company_id`, `linked_type` (`PURCHASE`, `DELIVERY_NOTE`, `SETTLEMENT`, `EXPENSE`), `linked_id`, `image_url`, `uploaded_at`. Images only, optional.

### `DayClose`
- `id`, `company_id`, `date`, `closed_at`
- Once a date has a `DayClose` record, no direct edits to that day's entries are permitted through the normal UI.

### `ErrorFlag`
- `id`, `linked_type`, `linked_id`, `flagged_at`, `reason` (optional), `correcting_entry_id`
- Correcting a closed-day entry: original record gets an `ErrorFlag`, stays in the DB untouched (never deleted), and a new corrected record is created and linked via `correcting_entry_id`. Reports should exclude flagged-error records from totals but keep them visible in an audit view.

## 3. Business Logic Rules (condensed — see decisions log for full rationale)

1. No grading step. Grade is implied by channel destination.
2. Rate is locked at `DeliveryNote` creation — settlement never renegotiates price, only quantity (plus the price-variance exception in §2 above).
3. Commission/Reserve on Market sales: entered as billed, never calculated. No 11%/2% formula anywhere in code.
4. GST/TDS/transport deductions on buyer bills: not modeled. Whatever net figure is on the bill is the figure entered.
5. No advance-payment tracking system — only transactions with a bill/memo/note get entered at all.
6. Spoiled/unsellable returns are a permanent loss (`StockMovement` state `LOSS`), never re-enter `AVAILABLE`.
7. Uncollected outstanding balances are not manually written off — period-end P&L calculation treats aged outstanding as loss automatically (exact aging threshold: **confirm with client before implementing** — flagged open in decisions log).
8. Single role for data entry: Merchant. Auditor is read-only, no entry screens exposed to that role at all.
9. Day-close is silent and automatic (e.g., end-of-day rollover, or explicit "Close Day" button — **confirm which trigger model** before building the day-close job). Corrections after close go through the `ErrorFlag` flow only.

## 4. Build Order (phases, roughly matching original 4-week MVP scope)

1. **Foundation** — Auth, Company switcher, Party master CRUD, base schema/migrations.
2. **Purchase + Stock** — Purchase entry (all 3 types), `StockMovement` ledger, reconciliation view.
3. **Delivery & Settlement** — Delivery Note creation, Settlement entry (incl. partial settlements, returns, spoilage, price variance), stock state transitions.
4. **Sales** — Factory/Market/Fish Mill settlement rules, Direct Local Sale, Owner Reserve account.
5. **Ledgers & Day Book** — generic `LedgerEntry` views per party, expense entry + category ledgers, Day Book aggregation screen (both cash-flow and COGS-matched P/F, per earlier walkthrough).
6. **Reports** — Balance Sheet, P&L (day/month/year), per-party statements (exportable), reconciliation integrity report.
7. **Attachments, Day-Close, Error Flow** — image upload, day locking, error-flag correction flow.
8. **Dashboard & Polish** — today's snapshot tiles (purchase/sale/expense/profit/outstanding/stock), pending-settlement alerts.

## 5. UI-facing requirement (not just data model)

Every generated `DeliveryNote` or `Settlement`/bill document for a party must display that party's **previous outstanding balance** at the top, before the current transaction line — this is how price-variance debt (§2) and normal outstanding stay visible to both merchant and buyer, not buried in a ledger screen nobody checks. Treat this as a hard UI requirement, not a nice-to-have.

## 6. Open items to confirm before/while building

- Postgres vs MySQL — pick one before first migration.
- Aged-outstanding-to-loss threshold (§3.7) — needs a number (e.g., 90 days) before the P&L job can be written.
- Day-close trigger (§3.9) — automatic rollover at midnight vs. explicit merchant action.

## 7. Offline support — deferred, not decided against

V1 is built online-first. Offline (entry screens working with no signal, syncing when connection returns) is intentionally **not** in V1 scope — it's a decision to revisit after real usage shows whether it's actually needed, not a hypothetical to build against now. The UUID primary-key strategy in §1 is the only preparation made for it; everything else (service worker, local sync queue, installable PWA) can be layered on top later without touching the core schema or hosting setup.
