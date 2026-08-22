@AGENTS.md

# FMS — working rules for this repo

Read `docs/BFM_DOMAIN_SPEC.md` before changing anything that touches money, and
`docs/BFM_REBUILD_PLAN.md` before starting a phase of work. Those two files are
the source of truth; this file is the short version that must never be violated.

## What this business is

BFM is a **fish merchant**. It buys fish outright from boats (via Society, KFDC,
or private/local sellers), grades it, and sells it on to factories, markets, fish
mills and local buyers. **BFM is not a commission agent.** Anything in this
codebase that treats BFM as earning commission, or as holding a seller's money,
is a bug — see F2 in the spec.

## Money invariants — never break these

1. **The buying day is the accounting date.** `date` on every voucher is the day
   the fish was *bought*, not the day the voucher happened. `saleDate`,
   `spentOn`, `dispatchedOn` are records only and must never move a figure.

2. **Vehicle rent is expensed exactly once**, on the trip, dated to the buying
   day. The advance and any payment made by a market party are *settlements
   against that rent*, never separate expenses. If you find yourself adding a
   second rent expense, stop.

3. **Market revenue = net bill + rent deducted on that bill.** Commission,
   labour and reserve stay netted inside the net bill and are not posted
   separately. Factory, fish mill and local revenue = the bill amount, full stop.

4. **Commission is a cost charged to us**, netted into the bill. Never credit it
   to a BFM account.

5. **Reserve is money a market party withholds.** It reduces profit when
   withheld and is recognised as income when collected. Track a balance **per
   market party** — never pooled.

6. **One trip, one buying day, one vehicle.** A load is never split across
   buying days.

7. **Settlements are party-level**, against the running balance — never
   allocated to a specific bill.

8. **A sale/expense links to its trip by `deliveryNoteId`**, never by matching
   date + vehicle text.

## Roles

Admin is the only role that may edit a saved voucher. Guards live in
`src/lib/session.ts` — `requireEntry()` / `requireAdmin()` on every server
action, and `canEnter()` / `canEdit()` / `canAdminister()` for the matching UI.
A hidden button and a rejected action must never disagree.

## Before you say a phase is done

```bash
npm run lint && npm run build   # both must pass clean
npm run db:verify               # ledger running balances must reconcile
npm test                        # money math, once it exists
```

## House style

- Server Actions for writes; no API routes except where a browser needs a URL.
- Money is `Decimal(14,2)`; quantities `Decimal(12,3)`. Never `number` for money.
- Dates decided on India time via `businessToday()` in `src/lib/format.ts`.
  Never `new Date()` or `toISOString()` for a business date.
- UUID primary keys, generated client-side. Never switch to autoincrement.
- Masters are archived, never deleted.
