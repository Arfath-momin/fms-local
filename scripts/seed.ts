// Seed: companies, centres, users, expense categories, masters, and one
// complete trading day entered the way the business actually works.
//
// The sample day is the 16 Aug worked example from docs/BFM_REBUILD_PLAN — a
// real day with three trucks, a market bill carrying the rent, a factory bill
// and a fish-mill bill. Seeding THAT rather than arbitrary rows means
// `npm run db:seed && npm run db:verify` demonstrates the §2 money rules end to
// end: the day's gross profit must read ₹31,400 and the transporters must all
// close at zero.
//
// Run with `npm run db:seed`. Re-runnable — it clears transactional data first.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import type { PartyType } from "../src/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { postLedgerEntries } from "../src/lib/ledger";
import { DIRECT_CODES, OVERHEAD_CODES } from "../src/lib/expense";
import { refreshTripStatus } from "../src/lib/trip";
import { nextDocumentNo, SERIES_PREFIX } from "../src/lib/document-series";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const D = (v: number | string) => new Prisma.Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** The buying day everything below is accounted to. */
const BUYING_DAY = day("2026-08-16");

const CATEGORY_NAMES: Record<string, string> = {
  ICE: "Ice",
  LOADERS: "Loaders",
  LADIES: "Ladies",
  BATHA: "Batha",
  CANTEEN: "Canteen",
  RENT: "Vehicle Rent",
  SALARY: "Salaries",
  OFFICE_RENT: "Office Rent",
  OTHER: "Other",
};

async function main() {
  // --- clear transactional data (idempotent re-run) ----------------------
  // Order matters: children before parents, and ledger entries before the
  // parties they hang off.
  await prisma.ledgerEntry.deleteMany();
  await prisma.reserveCollection.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.saleLine.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.deliveryNoteLine.deleteMany();
  await prisma.deliveryNote.deleteMany();
  await prisma.purchaseLine.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.expenseLine.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.attachment.deleteMany();
  // Counters reset with the data they numbered, so a reseed starts at 1.
  await prisma.documentSeries.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.expenseCategory.deleteMany();
  await prisma.centre.deleteMany();
  await prisma.party.deleteMany();

  // --- companies and centres ---------------------------------------------
  const companies: Record<string, string> = {};
  const centres: Record<string, string> = {};
  for (const [i, name] of ["BFM", "B2B"].entries()) {
    const c = await prisma.company.upsert({
      where: { name },
      update: {},
      create: { name, colour: i === 0 ? "#1e4d8c" : "#8c5a1e" },
      select: { id: true },
    });
    companies[name] = c.id;
    const centre = await prisma.centre.create({
      data: { companyId: c.id, name: "Malpe" },
      select: { id: true },
    });
    centres[name] = centre.id;
  }
  const BFM = companies["BFM"];
  const MALPE = centres["BFM"];

  // --- users --------------------------------------------------------------
  // Published passwords, deliberately: this is sample data for a development
  // database. scripts/bootstrap.ts is what creates accounts on a live server.
  const hash = await bcrypt.hash("password123", 10);
  for (const [email, name, role] of [
    ["owner@bfm.test", "Owner", "SUPER_ADMIN"],
    ["admin@bfm.test", "Admin", "ADMIN"],
    ["clerk@bfm.test", "Clerk", "ACCOUNTANT"],
    ["ca@bfm.test", "Auditor", "AUDITOR"],
  ] as const) {
    const u = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, role, passwordHash: hash },
      select: { id: true },
    });
    await prisma.userCompany.createMany({
      data: Object.values(companies).map((companyId) => ({
        userId: u.id,
        companyId,
      })),
      skipDuplicates: true,
    });
  }

  // --- expense categories -------------------------------------------------
  // The DIRECT / OVERHEAD split is the whole point: only DIRECT costs reach a
  // buying day's gross profit.
  const categoryId: Record<string, string> = {};
  for (const companyId of Object.values(companies)) {
    let order = 0;
    for (const code of [...DIRECT_CODES, ...OVERHEAD_CODES]) {
      const kind = (DIRECT_CODES as readonly string[]).includes(code)
        ? "DIRECT"
        : "OVERHEAD";
      const cat = await prisma.expenseCategory.create({
        data: {
          companyId,
          code,
          name: CATEGORY_NAMES[code] ?? code,
          kind,
          allowsLines: code === "OTHER",
          sortOrder: order++,
        },
        select: { id: true },
      });
      if (companyId === BFM) categoryId[code] = cat.id;
    }
  }

  // --- masters ------------------------------------------------------------
  const partyCache = new Map<string, string>();
  async function party(name: string, type: PartyType): Promise<string> {
    const key = `${type}:${name}`;
    const hit = partyCache.get(key);
    if (hit) return hit;
    const p = await prisma.party.upsert({
      where: { name_type: { name, type } },
      update: {},
      create: { name, type },
      select: { id: true },
    });
    partyCache.set(key, p.id);
    return p.id;
  }

  const society = await party("Society", "PURCHASE_GROUP");
  const marketA = await party("Kondatty", "MARKET_BUYER");
  const marketB = await party("City Market", "MARKET_BUYER");
  const marketC = await party("Malpe Market", "MARKET_BUYER");
  const factory = await party("West Coast Marine", "FACTORY");
  const mill = await party("Karavali Fishmeal", "FISH_MILL");
  const icePlant = await party("Malpe Ice Plant", "EXPENSE_VENDOR");
  const loaders = await party("Loaders", "EXPENSE_VENDOR");

  // Three transporters, one per truck, so each trip's rent settles against a
  // named account rather than a shared bucket.
  const transporters = {
    market: await party("Ravi Transport", "TRANSPORTER"),
    factory: await party("Shetty Carriers", "TRANSPORTER"),
    mill: await party("Local Tempo", "TRANSPORTER"),
  };

  const vehicles = {
    market: await prisma.vehicle.create({
      data: { companyId: BFM, number: "KA20B5521", transporterId: transporters.market },
      select: { id: true },
    }),
    factory: await prisma.vehicle.create({
      data: { companyId: BFM, number: "KA20A9087", transporterId: transporters.factory },
      select: { id: true },
    }),
    mill: await prisma.vehicle.create({
      data: { companyId: BFM, number: "KA20C3311", transporterId: transporters.mill },
      select: { id: true },
    }),
  };

  const scope = { companyId: BFM, centreId: MALPE };

  // --- purchases: ₹1,85,000 -----------------------------------------------
  const purchase = await prisma.purchase.create({
    data: {
      ...scope,
      partyId: society,
      billNo: "S-1042",
      type: "SOCIETY",
      amount: D(185_000),
      date: BUYING_DAY,
      lines: {
        create: [
          { particular: "Bangda", qtyKg: D(900), pricePerKg: D(125), total: D(112_500) },
          { particular: "Anjal", qtyKg: D(150), pricePerKg: D(460), total: D(69_000) },
          { particular: "Tarli", qtyKg: D(50), pricePerKg: D(70), total: D(3_500) },
        ],
      },
    },
    select: { id: true },
  });
  await postLedgerEntries(prisma, [
    { ...scope, partyId: society, type: "CREDIT", sourceType: "PURCHASE", sourceId: purchase.id, amount: D(185_000), date: BUYING_DAY },
  ]);

  // --- direct expenses: ₹15,000 -------------------------------------------
  for (const [code, vendor, amount] of [
    ["ICE", icePlant, 7_000],
    ["LOADERS", loaders, 5_000],
    ["CANTEEN", null, 3_000],
  ] as const) {
    const e = await prisma.expense.create({
      data: {
        ...scope,
        categoryId: categoryId[code],
        // Canteen has no vendor worth a ledger — partyId is optional now, and
        // forcing one only fills the master with junk.
        partyId: vendor,
        amount: D(amount),
        date: BUYING_DAY,
        spentOn: BUYING_DAY,
      },
      select: { id: true },
    });
    if (vendor) {
      await postLedgerEntries(prisma, [
        { ...scope, partyId: vendor, type: "CREDIT", sourceType: "EXPENSE", sourceId: e.id, amount: D(amount), date: BUYING_DAY },
      ]);
    }
  }

  // --- three trips: dispatched with an advance only -----------------------
  // The rent column stays null here. Its total depends on the kilometres the
  // driver covers, so it is recorded by the bill that reports it — see
  // recordTripRent below.
  const trips: Record<string, string> = {};
  const tripBillNo: Record<string, string> = {};
  for (const [key, channel, vehicle, transporterId, _rent, advance] of [
    ["market", "MARKET", vehicles.market.id, transporters.market, 20_000, 5_000],
    ["factory", "FACTORY", vehicles.factory.id, transporters.factory, 8_000, null],
    ["mill", "FISH_MILL", vehicles.mill.id, transporters.mill, 4_000, null],
  ] as const) {
    // Issued from the same counter the app uses, so seeded notes are numbered
    // exactly as entered ones would be.
    const billNo = await nextDocumentNo(prisma, BFM, SERIES_PREFIX.DELIVERY_NOTE);
    tripBillNo[key] = billNo;
    const trip = await prisma.deliveryNote.create({
      data: {
        ...scope,
        billNo,
        date: BUYING_DAY,
        channel,
        vehicleId: vehicle,
        // Left null: the total rent is not known until the driver reports his
        // kilometres, which happens on the last market bill.
        rentAmount: null,
        advancePaid: advance === null ? null : D(advance),
        // Recomputed below once the bills are in — DISPATCHED is only the
        // state a trip is created in.
        status: "DISPATCHED",
        lines: {
          create: [{ particulars: "Mixed", kg: D(300), box: 100, bigBox: 0, loose: 0, pcs: 0 }],
        },
      },
      select: { id: true },
    });
    trips[key] = trip.id;

    // Only the advance at dispatch. The rent itself is credited and expensed
    // by the bill that reports it — see the market and factory sections below.
    if (advance) {
      await postLedgerEntries(prisma, [
        { ...scope, partyId: transporterId, type: "DEBIT", sourceType: "PAYMENT", sourceId: trip.id, amount: D(advance), date: BUYING_DAY },
      ]);
    }
  }

  /**
   * Record a trip's rent at the moment it becomes known — on the bill.
   *
   * Credits the transporter the whole rent, debits back what the paying party
   * handed the driver, and expenses it once to the buying day. Mirrors
   * postSaleLedger + postTripRentExpense in the sale action, so seeded data
   * reads exactly like data entered through the app.
   */
  async function recordTripRent(args: {
    tripId: string;
    transporterId: string;
    payerId: string | null;
    saleId: string;
    rentTotal: number;
    advance: number;
    billNo: string;
  }) {
    const carried = args.rentTotal - args.advance;
    await prisma.deliveryNote.update({
      where: { id: args.tripId },
      data: { rentAmount: D(args.rentTotal) },
    });
    await postLedgerEntries(prisma, [
      { ...scope, partyId: args.transporterId, type: "CREDIT", sourceType: "RENT", sourceId: args.saleId, amount: D(args.rentTotal), date: BUYING_DAY },
      // RENT_BY_PARTY only when somebody actually stood in between. On a
      // factory or mill trip BFM pays the driver directly, so the settling
      // debit is an ordinary PAYMENT posted by the caller — posting both would
      // settle the same rent twice and leave him looking overpaid.
      ...(carried > 0 && args.payerId
        ? [
            { ...scope, partyId: args.transporterId, type: "DEBIT" as const, sourceType: "RENT_BY_PARTY" as const, sourceId: args.saleId, amount: D(carried), date: BUYING_DAY },
            { ...scope, partyId: args.payerId, type: "CREDIT" as const, sourceType: "RENT_BY_PARTY" as const, sourceId: args.saleId, amount: D(carried), date: BUYING_DAY },
          ]
        : []),
    ]);
    await prisma.expense.create({
      data: {
        ...scope,
        categoryId: categoryId["RENT"],
        partyId: args.transporterId,
        amount: D(args.rentTotal),
        date: BUYING_DAY,
        spentOn: BUYING_DAY,
        notes: `Vehicle rent for trip ${args.billNo}`,
        details: { tripId: args.tripId },
      },
    });
  }

  // --- the market bill, carrying the trip's rent --------------------------
  //   total 180,000 − commission 3,600 − labour 2,000 − reserve 6,000
  //                 − rent 20,000 = net 148,400
  // Revenue recognised is net + rent = 168,400.
  // Three stops on the one market truck, which is how a market trip really
  // works — and what makes the reserve balance a per-party question. Together:
  //   total 180,000 − commission 3,600 − labour 2,000 − reserve 6,000
  //                 − rent 20,000 = net 148,400
  // Revenue recognised is net + rent = 168,400.
  const marketBills = [
    { party: marketA, billNo: "M-501", place: "Kondatty",     total: 80_000, comm: 1_600, labour: 900,  reserve: 2_500, boxes: 40, rent: 0 },
    { party: marketB, billNo: "M-502", place: "City Market",  total: 55_000, comm: 1_100, labour: 600,  reserve: 2_000, boxes: 30, rent: 0 },
    // The LAST stop pays the driver the rent balance on BFM's behalf.
    { party: marketC, billNo: "M-503", place: "Malpe Market", total: 45_000, comm: 900,   labour: 500,  reserve: 1_500, boxes: 30, rent: 20_000 },
  ];

  for (const b of marketBills) {
    const net = b.total - b.comm - b.labour - b.reserve - b.rent;
    const sale = await prisma.sale.create({
      data: {
        ...scope,
        type: "MARKET",
        partyId: b.party,
        billNo: b.billNo,
        date: BUYING_DAY,
        saleDate: day("2026-08-18"),
        deliveryNoteId: trips["market"],
        amount: D(net),
        totalBill: D(b.total),
        commission: D(b.comm),
        commissionRate: D(2),
        otherDeduction: D(b.labour),
        reserve: D(b.reserve),
        carriesRent: b.rent > 0,
        rentDeducted: b.rent > 0 ? D(b.rent) : null,
        place: b.place,
        // Box counts are what the trip reconciliation tallies against the 100
        // boxes dispatched.
        // A market line records WHICH market took HOW MANY boxes. The money is
        // the net the market paid, not a rate times a weight, so the weight
        // and rate columns are zero exactly as the form now leaves them.
        lines: {
          create: [
            {
              particular: "Mixed",
              box: b.boxes,
              qtyKg: D(0),
              ratePerKg: D(0),
              total: D(0),
            },
          ],
        },
      },
      select: { id: true },
    });

    await postLedgerEntries(prisma, [
      // The party owes the net bill for the fish.
      { ...scope, partyId: b.party, type: "DEBIT", sourceType: "SALE", sourceId: sale.id, amount: D(net), date: BUYING_DAY },
    ]);

    if (b.rent > 0) {
      // The last stop is where the driver reports the trip's total rent.
      await recordTripRent({
        tripId: trips["market"],
        transporterId: transporters.market,
        payerId: b.party,
        saleId: sale.id,
        rentTotal: b.rent,
        advance: 5_000,
        billNo: tripBillNo["market"],
      });
    }
  }

  // --- factory and mill bills, paid in full -------------------------------
  for (const [type, partyId, tripKey, amount, billNo] of [
    ["FACTORY", factory, "factory", 70_000, "F-88"],
    ["FISH_MILL", mill, "mill", 25_000, "FM-30"],
  ] as const) {
    const sale = await prisma.sale.create({
      data: {
        ...scope,
        type,
        partyId,
        billNo,
        date: BUYING_DAY,
        saleDate: day("2026-08-18"),
        deliveryNoteId: trips[tripKey],
        amount: D(amount),
      },
      select: { id: true },
    });
    await postLedgerEntries(prisma, [
      { ...scope, partyId, type: "DEBIT", sourceType: "SALE", sourceId: sale.id, amount: D(amount), date: BUYING_DAY },
    ]);
    // BFM pays these drivers in full on their return, so the bill records the
    // rent and the payment goes straight to the transporter — no market party
    // stands in between.
    const rent = tripKey === "factory" ? 8_000 : 4_000;
    const transporterId =
      tripKey === "factory" ? transporters.factory : transporters.mill;
    await recordTripRent({
      tripId: trips[tripKey],
      transporterId,
      payerId: null,
      saleId: sale.id,
      rentTotal: rent,
      advance: 0,
      billNo: tripBillNo[tripKey],
    });
    await postLedgerEntries(prisma, [
      { ...scope, partyId: transporterId, type: "DEBIT", sourceType: "PAYMENT", sourceId: sale.id, amount: D(rent), date: BUYING_DAY },
    ]);
  }

  // --- one overhead, to prove it stays out of the day's gross -------------
  await prisma.expense.create({
    data: {
      ...scope,
      categoryId: categoryId["SALARY"],
      amount: D(40_000),
      date: BUYING_DAY,
      spentOn: BUYING_DAY,
      notes: "Monthly salaries — OVERHEAD, must not touch this day's gross.",
    },
  });

  // Statuses are derived from the bills, exactly as the sale action derives
  // them — so the seeded data reads the same as data entered through the app.
  for (const tripId of Object.values(trips)) {
    await refreshTripStatus(prisma, tripId);
  }

  console.log("Seeded the 16 Aug 2026 worked example for BFM / Malpe.");
  console.log("  purchases 185,000 · direct 47,000 · revenue 263,400");
  console.log("  expected GROSS profit 31,400 (salary 40,000 excluded)");
  console.log("  reserve outstanding 6,000 across three market parties");
  console.log("Sign in as owner@bfm.test / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
