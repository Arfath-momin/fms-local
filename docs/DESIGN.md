# FMS — Design Direction

_How it should look and feel. The data rules live in `BFM_DOMAIN_SPEC.md`._
_Rewritten 22 Aug 2026, replacing `FMS_Design_Instructions.md`, whose screen
list described the retired grading / settlement / inventory flow._

---

## The look

Premium, TallyPrime-credibility — not a consumer app. The client explicitly
rejected a minimal/playful look as "childish". This is bookkeeping software a CA
will judge on sight.

- **Dense ledger tables**, not card-heavy layouts. Numbers align right, in
  tabular figures.
- **Gateway-style navigation** — Dashboard / Vouchers / Masters / Ledgers /
  Reports. It mirrors the mental model of Tally users, which this client and any
  future CA client already has.
- **Debit/credit colour convention** throughout, consistent and never
  decorative. Red for debit-side, a restrained green for credit-side. One pair,
  used everywhere, no exceptions.
- **Drill-down on every number.** Every total on a dashboard or report should
  click through to the transactions behind it. In a bookkeeping tool trust comes
  from traceability, not from summaries.
- **Typography:** a serif/slab face for statement headers, tabular figures for
  every number. No rounded, friendly UI fonts.
- **No illustrations, no mascots, no empty-state cartoons.** Empty states are
  plain text with a clear next action.

## Company identity is the first rule

You must never be in doubt whose books are on screen. BFM and B2B are separate
businesses sharing one installation, and mixing them up is the single worst
error this software could allow. The company band and switcher chip carry a
per-company colour stored on the company record — not hardcoded in the
stylesheet, so a third company is never rendered in BFM's blue.

## Print

Printed documents are documents, not screenshots of screens. They drop the app
chrome entirely (the `(print)` route group exists for this), use a white header
band with the company mark centred, and a light grey body. A "Plain (no colour)"
toggle strips both, because colour on paper is a running cost for a merchant
printing fifty notes a day.

## Tone for empty and error states

The audience is a working merchant, not a tech-fluent user. Copy is plain and
directive, never clever — "No deliveries pending settlement", not something
cute. Error messages say exactly what is wrong and what to do: "Accepted +
Returned + Spoiled must equal 40 kg sent — currently totals 35 kg."

---

## Screens the retired spec called for — do NOT build these

Listed so nobody reinstates them from the old document:

- **Grading / sorting screen** — the flow has no grading step.
- **Inventory reconciliation view** — there is no inventory accounting at all
  (spec §2, "Out of scope").
- **Owner Reserve account view** — reserve is derived per market party and is
  never pooled into one account (spec §2, invariant 5).
- **Day Book dual result row / day-close indicator** — day closing was removed
  and its table dropped.
- **Error-flagged entry indicator** — `ErrorFlag` is being deleted (spec §3.7).
- **Inline commission/reserve percentage screens framed as BFM's income** —
  commission is a cost charged *to* BFM (invariant 4).
