"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireEntry } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { postLedgerEntries, removeLedgerEntries } from "@/lib/ledger";

export type RecordRentState = { error: string } | null;

const DECIMAL2 = /^\d+(\.\d{1,2})?$/;
const ZERO = new Prisma.Decimal(0);
const RENT_CATEGORY_CODE = "RENT";

/**
 * Record a trip's rent when the driver gets back — for the channels where BFM
 * settles with him directly.
 *
 * A MARKET trip does not use this: its last stop hands the driver the balance
 * and deducts it from their bill, so the rent is recorded there. On a FACTORY,
 * FISH_MILL or LOCAL trip nobody stands in between — the factory pays its bill
 * in full and the driver collects from BFM — so the trip itself is where the
 * total finally becomes known.
 *
 * Posts, against the transporter:
 *
 *   RENT     credit the whole rent — we owe it now that the kilometres are in
 *   PAYMENT  debit whatever was handed over on his return
 *
 * plus the rent as a DIRECT expense of the trip's BUYING DAY, once. Together
 * with the advance already debited at dispatch, a fully-paid trip closes the
 * transporter at zero; a partly-paid one leaves exactly what is still owed,
 * which is the signal the outstanding screen exists to show.
 */
export async function recordTripRent(
  deliveryNoteId: string,
  _prev: RecordRentState,
  formData: FormData
): Promise<RecordRentState> {
  await requireEntry();
  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  const totalRaw = String(formData.get("rentTotal") ?? "").trim();
  const paidRaw = String(formData.get("paidNow") ?? "").trim();

  if (!DECIMAL2.test(totalRaw) || Number(totalRaw) <= 0)
    return { error: "Enter the trip's total rent." };
  const rentTotal = new Prisma.Decimal(totalRaw);

  try {
    await prisma.$transaction(async (tx) => {
      const trip = await tx.deliveryNote.findFirst({
        where: {
          id: deliveryNoteId,
          companyId: company.id,
          centreId: centre.id,
        },
        select: {
          id: true,
          billNo: true,
          date: true,
          channel: true,
          advancePaid: true,
          vehicle: { select: { transporterId: true } },
        },
      });
      if (!trip) throw new Error("That trip no longer exists.");

      // A market trip's rent belongs to the bill that carried it. Recording it
      // here as well would credit the transporter twice for one journey.
      if (trip.channel === "MARKET")
        throw new Error(
          "A market trip's rent is recorded on the bill that carried it — " +
            "tick “last stop” on that market sale instead."
        );

      const advance = trip.advancePaid ?? ZERO;
      if (rentTotal.lt(advance))
        throw new Error(
          `An advance of ${advance.toFixed(2)} has already gone to the driver, ` +
            `so the total rent cannot be ${rentTotal.toFixed(2)}.`
        );

      const balance = rentTotal.sub(advance);
      // Blank means he was paid the balance in full on his return, which is
      // the normal case. A smaller figure leaves the rest genuinely owed.
      let paidNow = balance;
      if (paidRaw) {
        if (!DECIMAL2.test(paidRaw))
          throw new Error("Paid now must be a number (up to 2 decimals).");
        paidNow = new Prisma.Decimal(paidRaw);
        if (paidNow.gt(balance))
          throw new Error(
            `Only ${balance.toFixed(2)} is outstanding after the advance, so ` +
              `${paidNow.toFixed(2)} cannot be paid against it.`
          );
      }

      // Rebuilt rather than patched, so re-recording a corrected figure does
      // not leave the old rent standing beside the new one.
      await removeLedgerEntries(tx, {
        sourceId: trip.id,
        sourceType: ["RENT"],
      });
      await tx.expense.deleteMany({
        where: { details: { path: ["tripId"], equals: trip.id } },
      });

      const common = {
        companyId: company.id,
        centreId: centre.id,
        partyId: trip.vehicle.transporterId,
        sourceId: trip.id,
        date: trip.date,
      };
      await postLedgerEntries(tx, [
        {
          ...common,
          type: "CREDIT" as const,
          sourceType: "RENT" as const,
          amount: rentTotal,
        },
        ...(paidNow.gt(0)
          ? [
              {
                ...common,
                type: "DEBIT" as const,
                sourceType: "PAYMENT" as const,
                amount: paidNow,
              },
            ]
          : []),
      ]);

      const category = await tx.expenseCategory.findUnique({
        where: {
          companyId_code: { companyId: company.id, code: RENT_CATEGORY_CODE },
        },
        select: { id: true },
      });
      if (!category)
        throw new Error(
          `No "${RENT_CATEGORY_CODE}" expense category exists — add one under ` +
            `Masters before recording a trip's rent.`
        );

      await tx.expense.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          categoryId: category.id,
          partyId: trip.vehicle.transporterId,
          amount: rentTotal,
          // The trip's BUYING DAY, not today — the cost belongs to the day the
          // fish was bought, whatever day the driver got back.
          date: trip.date,
          spentOn: new Date(),
          notes: `Vehicle rent for trip ${trip.billNo}`,
          details: { tripId: trip.id },
        },
      });

      await tx.deliveryNote.update({
        where: { id: trip.id },
        data: { rentAmount: rentTotal },
      });
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not record the rent.",
    };
  }

  revalidatePath(`/vouchers/deliveries/${deliveryNoteId}`);
  revalidatePath("/vouchers/deliveries");
  return null;
}
