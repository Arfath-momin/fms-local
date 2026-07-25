import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { toInputDate } from "@/lib/format";
import { updateSale } from "../../actions";
import { SaleForm } from "../../sale-form";

export default async function EditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (session.role !== "MERCHANT") redirect(`/vouchers/sales/${id}`);

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      party: { select: { name: true } },
      careOfParty: { select: { name: true } },
      lines: { orderBy: { id: "asc" } },
    },
  });
  if (!sale) notFound();

  // Closed days are final — corrections would go through the error-flag flow.
  const dayClose = await prisma.dayClose.findUnique({
    where: {
      companyId_centreId_date: {
        companyId: sale.companyId,
        centreId: sale.centreId,
        date: sale.date,
      },
    },
  });
  if (dayClose) redirect(`/vouchers/sales/${id}`);

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">
        Edit {SALE_TYPE_LABELS[sale.type]} Sale
      </h1>
      <SaleForm
        type={sale.type}
        action={updateSale.bind(null, sale.id)}
        initial={{
          billNo: sale.billNo,
          date: toInputDate(sale.date),
          buyerName: sale.party.name,
          careOfName: sale.careOfParty?.name ?? "",
          amountReceived: sale.amountReceived.toString(),
          place: sale.place ?? "",
          totalBill: sale.totalBill?.toString() ?? "",
          netBill: sale.type === "MARKET" ? sale.amount.toString() : "",
          amount: sale.type === "FACTORY" ? sale.amount.toString() : "",
          weight: sale.weight?.toString() ?? "",
          vehicleNo: sale.vehicleNo ?? "",
          netWeight: sale.netWeight?.toString() ?? "",
          placeOfLoading: sale.placeOfLoading ?? "",
          returnNote: sale.returnNote ?? "",
          lines: sale.lines.map((l) => ({
            particular: l.particular,
            box: l.box != null ? String(l.box) : "",
            qtyKg: l.qtyKg.toString(),
            ratePerKg: l.ratePerKg.toString(),
            count: l.count != null ? String(l.count) : "",
          })),
        }}
        submitLabel="Save Changes"
      />
    </div>
  );
}
