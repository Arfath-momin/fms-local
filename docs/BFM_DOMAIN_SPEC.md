# BFM Domain Spec

_Authoritative description of the business and the target data model._
_Written 22 Aug 2026. Supersedes any conflicting comment in `schema.prisma`._

---

## 1. What the business does

BFM is a **fish merchant / trader**. It buys fish outright, owns it, and sells it
on. It is **not** a commission agent selling on a boat owner's behalf — several
comments in the current schema assume otherwise and are wrong.

### The daily cycle

1. **Buy**, before dawn, under a (company, centre):
   - **Society** and **KFDC** — the bill names individual boats, but the money is
     owed to the society. Boats are a name registry for reconciliation only and
     never carry a ledger.
   - **Private** and **Local** — independent sellers, each with their own ledger.

2. **Grade and pack** at the centre. Direct costs incurred on the whole day's
   catch: **ice, loaders, ladies, batha, canteen**. (Batha is a plain worker
   allowance — nothing to do with drivers or trips.)

3. **Dispatch** by grade, one truck per channel:

   | Grade | Channel | Rent flow | Deductions on their bill |
   |---|---|---|---|
   | Best | **Factory** | BFM pays the driver in full on his return | None — they pay the bill in full |
   | Good | **Market** | Advance at departure; **last market** pays the balance and deducts it | Commission, labour, reserve, and rent at the last stop |
   | Low | **Fish mill** | BFM pays in full on return | None |
   | — | **Local buyer** | n/a | None |

   A market truck visits several markets in one run. One truck, one buying day —
   loads are never mixed across buying days.

4. **Bills return 2–3 days later.** Every one of them is accounted to the
   **buying day**, never the day the bill arrived or the fish moved.

### The market bill

```
  Total bill
− Commission        (a % the market charges BFM — a cost, not income)
− Labour / other
− Reserve           (the market withholds it; BFM collects at year end)
− Vehicle rent      (last stop only — they paid the driver on BFM's behalf)
= Net bill          (what the market party actually pays BFM)
```

When collecting, the party owes: `net bill + their prior running balance`. That
is a print/collection view, never a stored field.

### Factory rejections

Factories reweigh on arrival and pay for less than was sent. The gap between
dispatched kilos and accepted kilos must be visible and reportable by factory.

---

## 2. Accounting rules

### Dates

`date` on every voucher = **the buying day**. It drives every ledger, statement,
register and report.

Record-only companions, read by nothing that computes a figure:
`Sale.saleDate`, `Expense.spentOn`, `DeliveryNote.dispatchedOn`.

### Revenue recognition

| Channel | Revenue posted |
|---|---|
| Market | `net bill + rentDeducted on that bill` |
| Factory / Fish mill / Local | the bill amount |

Commission, labour and reserve remain netted inside the net bill and are **not**
posted as separate expenses. Only the rent is grossed back up, because it is
settled through the transporter's account.

### Vehicle rent — the settlement chain

Rent is a property of the **trip**, entered once, dated to the buying day.

Market trip, rent ₹20,000, advance ₹5,000, last market pays ₹15,000:

| Account | Entry | Amount |
|---|---|---|
| Transporter | CREDIT `RENT` (trip) | 20,000 |
| Transporter | DEBIT `PAYMENT` (advance settlement) | 5,000 |
| Transporter | DEBIT `RENT_BY_PARTY` (sale) | 15,000 |
| **Transporter balance** | | **0** |
| Market party | DEBIT `SALE` (net bill + rent) | net + 15,000 |
| Market party | CREDIT `RENT_BY_PARTY` (sale) | 15,000 |
| **Market party owes** | | **net bill** |

Factory / fish mill trip, rent ₹8,000, no advance:

| Account | Entry | Amount |
|---|---|---|
| Transporter | CREDIT `RENT` (trip) | 8,000 |
| Transporter | DEBIT `PAYMENT` (settlement on his return) | 8,000 |

A transporter balance that does not close at zero means something is genuinely
unpaid. That is the signal — do not suppress it.

### Reserve

Reduces profit when withheld; recognised as income when collected. Balance is
**derived per market party**: `SUM(sales.reserve) − SUM(reserve collections)`.
Never pooled into one account.

### Expenses

Two kinds, flagged on the category:

- **DIRECT** — ice, loaders, ladies, batha, canteen, vehicle rent. Belong to a
  buying day. Enter **gross profit**.
- **OVERHEAD** — salaries, office rent, electricity. Belong to a month, not a
  catch. Enter **net profit** only, never the daily figure.

### Profit report — two tiers

```
  Revenue (by the rules above)
− Purchases
− Direct expenses
= GROSS PROFIT            per buying day, per company

− Overheads
+ Reserve collected
= NET PROFIT              per month, per company
```

P&L aggregates at company level, never per centre — purchase and sale are split
across centres deliberately.

### Out of scope (decided)

- **No cash or bank balances.** Party ledgers only. Settlement `mode` is a label,
  not an account. The model must not block adding this later.
- **No double-entry / trial balance.**
- **No inventory or stock accounting.**

---

## 3. Target schema

Only the deltas from the current `schema.prisma` are given. Everything not
mentioned stays as it is.

### 3.1 New — Vehicle master

```prisma
model Vehicle {
  id            String    @id @default(uuid())
  companyId     String    @map("company_id")
  /// Stored normalised (uppercase, no spaces or dashes) so lookups can never
  /// miss on formatting; display formatting is a UI concern.
  number        String
  transporterId String    @map("transporter_id")
  archivedAt    DateTime? @map("archived_at")
  createdAt     DateTime  @default(now()) @map("created_at")

  company     Company        @relation(fields: [companyId], references: [id])
  transporter Party          @relation("VehicleTransporter", fields: [transporterId], references: [id])
  trips       DeliveryNote[]

  @@unique([companyId, number])
  @@map("vehicles")
}
```

Add `TRANSPORTER` to `enum PartyType`.

### 3.2 Changed — DeliveryNote becomes the trip

Keep the model and table name. Renaming would churn every route under
`vouchers/deliveries` and `(print)/vouchers/deliveries` for no gain.

```prisma
enum TripChannel { MARKET  FACTORY  FISH_MILL  LOCAL }

enum TripStatus {
  DISPATCHED   // out, no bills yet
  PART_BILLED  // some bills in
  CLOSED       // all bills in, reconciled
}

model DeliveryNote {
  // --- existing: id, companyId, centreId, billNo, notes, audit fields ---

  /// THE BUYING DAY this load came from. One trip, one buying day.
  date           DateTime   @db.Date
  /// When the truck actually left. Record only.
  dispatchedOn   DateTime?  @map("dispatched_on") @db.Date

  channel        TripChannel
  vehicleId      String     @map("vehicle_id")

  /// Total rent agreed for this trip. Expensed once, on `date`.
  rentAmount     Decimal?   @map("rent_amount") @db.Decimal(14, 2)
  /// Paid to the driver before departure. MARKET only; null on other channels.
  advancePaid    Decimal?   @map("advance_paid") @db.Decimal(14, 2)

  status         TripStatus @default(DISPATCHED)
  /// Empty crates that came back. Closes the box loop.
  cratesReturned Int?       @map("crates_returned")

  /// Free text, retained for the printed note. No longer load-bearing —
  /// who received what comes from the bills.
  recipient      String?
  driverName     String?    @map("driver_name")
  mobileNo       String?    @map("mobile_no")

  vehicle Vehicle @relation(fields: [vehicleId], references: [id])
  lines   DeliveryNoteLine[]
  sales   Sale[]

  @@index([companyId, centreId, date])
  @@index([status])
  @@index([vehicleId])
}
```

Removed: `vehicleNo String` (now `vehicleId`). `recipient` becomes optional.

### 3.3 Changed — Sale

```prisma
model Sale {
  // --- existing fields ---

  /// The trip this bill came off. Required for MARKET, FACTORY and FISH_MILL.
  deliveryNoteId String?  @map("delivery_note_id")

  /// This bill carries the trip's vehicle rent — the last market stop.
  /// At most one sale per trip may set this; enforce in the action.
  carriesRent    Boolean  @default(false) @map("carries_rent")
  /// Rent deducted on this bill. Set only when carriesRent, and may not exceed
  /// the trip's unsettled rent.
  rentDeducted   Decimal? @map("rent_deducted") @db.Decimal(14, 2)
  /// Labour and sundry deductions on a market bill.
  otherDeduction Decimal? @map("other_deduction") @db.Decimal(14, 2)

  // commission / commissionRate / reserve stay, but their meaning changes:
  //   commission — charged to BFM by the market. Netted, never posted as income.
  //   reserve    — withheld by the market. Netted; balance tracked per party.
  // Both are MARKET-only. Factory, fish mill and local bills have no deductions.

  deliveryNote DeliveryNote? @relation(fields: [deliveryNoteId], references: [id])

  @@index([deliveryNoteId])
}
```

`SaleLine.box` becomes valid on **market** lines too (box count per market), and
`qtyKg` carries the accepted weight on **factory** lines for the rejection tally.

### 3.4 New — expense categories as data

```prisma
enum ExpenseKind { DIRECT  OVERHEAD }

model ExpenseCategory {
  id          String    @id @default(uuid())
  code        String    @unique      // ICE, LOADERS, LADIES, BATHA, CANTEEN, RENT, SALARY, OFFICE_RENT, OTHER
  name        String
  kind        ExpenseKind
  /// True for OTHER and similar: the voucher shows a name/amount line table
  /// that sums into `amount`.
  allowsLines Boolean   @default(false) @map("allows_lines")
  sortOrder   Int       @default(0) @map("sort_order")
  archivedAt  DateTime? @map("archived_at")

  expenses Expense[]
  @@map("expense_categories")
}

model ExpenseLine {
  id          String  @id @default(uuid())
  expenseId   String  @map("expense_id")
  description String
  amount      Decimal @db.Decimal(14, 2)

  expense Expense @relation(fields: [expenseId], references: [id], onDelete: Cascade)
  @@index([expenseId])
  @@map("expense_lines")
}
```

`Expense.category` (enum) becomes `Expense.categoryId` (FK). Drop
`enum ExpenseCategory`. `Expense.partyId` becomes **optional** — a canteen bill
or a salary line should not force junk master data.

### 3.5 New — reserve collection

```prisma
model ReserveCollection {
  id          String         @id @default(uuid())
  companyId   String         @map("company_id")
  centreId    String         @map("centre_id")
  partyId     String         @map("party_id")
  amount      Decimal        @db.Decimal(14, 2)
  /// The day the money was actually collected — this one is NOT a buying day.
  date        DateTime       @db.Date
  mode        SettlementMode @default(CASH)
  reference   String?
  notes       String?
  createdAt   DateTime       @default(now()) @map("created_at")
  createdById String?        @map("created_by_id")

  @@index([companyId, centreId, partyId])
  @@map("reserve_collections")
}
```

Recognised as income on `date` in the net-profit tier. Does **not** touch the
trade ledger — it clears the derived reserve balance instead.

### 3.6 Changed — LedgerSourceType

```prisma
enum LedgerSourceType {
  PURCHASE
  SALE
  EXPENSE
  PAYMENT
  RECEIPT
  RENT           // NEW — credit to the transporter when a trip is created
  RENT_BY_PARTY  // NEW — a market party paid the driver on BFM's behalf
  COMMISSION     // RETIRED — never post again
  RESERVE        // RETIRED — never post again
}
```

### 3.7 Delete outright

Free to remove because all current data is test data:

- `PartyType.LOCAL_SELLER` — retired, superseded by PURCHASE_GROUP
- `Purchase.boatId` (header) — superseded by `PurchaseLine.boatId`
- `model ErrorFlag` + `enum ErrorFlagLinkedType` — nothing creates flags
- The standing `COMMISSION` and `RESERVE` parties
- Any remaining day-close references

---

## 4. Validation rules to enforce in server actions

| Rule | Where |
|---|---|
| At most one sale per trip may set `carriesRent` | sale create/update |
| `rentDeducted` ≤ trip `rentAmount` − already settled | sale create/update |
| `deliveryNoteId` required for MARKET / FACTORY / FISH_MILL sales | sale create |
| Sale's `date` must equal its trip's `date` | sale create/update |
| A trip's `advancePaid` is allowed only when `channel = MARKET` | trip create |
| Warn (do not block) when a sale's buying day has no purchase at that centre | sale form |
| Deduction fields rejected on non-MARKET sales | sale create/update |
| Trip cannot close while billed boxes ≠ dispatched boxes, unless a variance reason is given | trip close |
