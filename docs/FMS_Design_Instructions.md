# FMS — Design Instructions (for Claude Code / Claude Design)

Separate from the build spec on purpose — this covers how it should *look and feel*, not how the data works. Give this to whichever tool is generating UI/screens.

---

## Design Direction (carried over, still holds)

Premium, TallyPrime-credibility — not a consumer app. The client explicitly rejected a minimal/playful look as "childish." This is bookkeeping software a CA will judge on sight.

- **Dense ledger tables**, not card-heavy layouts. Numbers align right, in tabular/monospaced figures.
- **Gateway-style navigation**: Dashboard / Vouchers / Masters / Ledgers / Reports — mirrors the mental model of Tally users, which this client and any future CA clients already have.
- **Debit/credit color convention** throughout — consistent, not decorative. Red for debit-side/outflow, a restrained green or blue for credit-side/inflow — pick one pair and use it everywhere, no exceptions.
- **Drill-down on every number.** Every total on a dashboard or report should be clickable through to the underlying transactions. This is a bookkeeping tool — trust comes from traceability, not from summaries alone.
- **Typography:** a serif or slab face for statement headers/titles (gives it the "formal document" weight), a proper tabular-figures sans or mono for all numeric data. Avoid rounded, friendly UI fonts entirely.
- **No illustrations, no mascots, no empty-state cartoons.** Empty states are plain text with a clear next action.

## New Screens Required (beyond the original 20-screen prototype)

The flow changed since the original design prompt — grading is gone, replaced by Delivery Note → Settlement. These screens need to exist or be revised:

1. **Company Switcher** — persistent, always visible (e.g., top-left next to the logo), showing BFM/B2B. Switching should feel instant and make unmistakably clear which company's data is currently on screen — consider a subtle but consistent color tag or label, since mixing these up is the single worst error this software could allow.

2. **Delivery Note screen** — dispatch a quantity to a buyer. Shows: fish type, qty, buyer, channel, rate (locked in), expected value. Status badge: Pending / Partially Settled / Settled. List view should make **pending-too-long** deliveries visually distinct (e.g., a subtle warning state after N days unsettled) — this is the exact kind of thing currently lost on WhatsApp.

3. **Settlement/Bill entry screen** — against a specific Delivery Note. Three quantity fields side by side (Accepted / Returned / Spoiled) that must sum to the original qty sent — enforce this visually (e.g., a running total that turns red until it balances). For Market channel specifically: separate clearly-labeled fields for Gross / Commission (marked "as billed — reference only") / Owner Reserve (as billed) / Net Received — make it visually obvious which of these are just recorded vs. which one (Reserve) is actively accumulating somewhere.

4. **Party statement / running balance header** — appears at the top of every generated Delivery Note or Settlement document: "Previous Balance: ₹X" before the current transaction. This must be genuinely prominent, not fine print — it's carrying real financial information (including price-variance debt) forward.

5. **Inventory reconciliation view** — a single screen per fish type showing Available / In Transit / Sold / Loss as a simple four-part bar or table that always sums to total purchased. This is the visual proof of "nothing is unaccounted for" — make it satisfying to look at, since it's the core trust-building screen of the whole product.

6. **Owner Reserve account view** — a simple running-balance ledger, styled consistently with other party ledgers, but clearly labeled as an internal account rather than a third-party one (e.g., a distinct icon or section, not just another row in Masters).

7. **Day Book — dual result row** — the daily entry screen keeps the familiar `Purchase | Expenses | Rent | Sale | P/F` row the client already knows, but add a small secondary line or toggle for the COGS-matched "true" profit figure, clearly labeled as the accrual-accurate number vs. the quick cash snapshot. Don't let these look like the same kind of number — differentiate them visually (e.g., one bold/primary, one smaller/secondary with a tooltip explaining the difference).

8. **Error-flagged entry indicator** — anywhere a transaction has been flagged as an error and corrected, show a small, unobtrusive but unmistakable marker (e.g., a strike-through amount with a "corrected" badge linking to the replacement entry) — this needs to be visible enough for a CA audit to trust it, without cluttering daily use.

9. **Day-close indicator** — closed days should look visually distinct in list/calendar views (e.g., a lock icon, slightly muted styling) so it's obvious at a glance which days are final vs. still editable.

## Screens from the original prompt that no longer apply

- Any dedicated **grading/sorting screen** — remove entirely, replaced by the Delivery Note flow above.
- Any screen that calculates commission/reserve percentages inline — replace with the "entered as billed" input pattern described in #3.

## Tone for empty/error states

Given the audience (a working merchant, not a tech-fluent user), copy should be plain and directive, not clever. "No deliveries pending settlement" rather than anything cute. Error messages should say exactly what's wrong and what to do ("Accepted + Returned + Spoiled must equal 40 kg sent — currently totals 35 kg").
