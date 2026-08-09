import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { canEdit, requireSession } from "@/lib/session";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { toInputDate } from "@/lib/format";
import { updateSale } from "../../actions";
import { ReviewPanel } from "../../../review-panel";
import { SaleForm } from "../../sale-form";

export default async function EditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (!canEdit(session.role)) redirect(`/vouchers/sales/${id}`);

  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const sale = await prisma.sale.findFirst({
    // Scoped, not just found by id. A voucher belonging to another company or
    // centre must not open — let alone be editable — from the scope you are in.
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
      party: { select: { name: true } },
      careOfParty: { select: { name: true } },
      lines: { orderBy: { id: "asc" } },
    },
  });
  if (!sale) notFound();

  // Drives the "choosing a new one replaces it" hint on the upload field.
  const existingAttachments = await prisma.attachment.count({
    where: { linkedType: "SALE", linkedId: sale.id },
  });

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">
        Edit {SALE_TYPE_LABELS[sale.type]} Sale
      </h1>
      {/* Whatever the accountant asked for, kept in view while it is fixed.
          Collapses to nothing when no review was requested. */}
      <div className="mb-4 empty:hidden [&>*]:mt-0">
        <ReviewPanel linkedType="SALE" linkedId={sale.id} noun="sale" />
      </div>
      <SaleForm
        type={sale.type}
        action={updateSale.bind(null, sale.id)}
        initial={{
          billNo: sale.billNo,
          date: toInputDate(sale.date),
          buyerName: sale.party.name,
          careOfName: sale.careOfParty?.name ?? "",
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
        existingAttachments={existingAttachments}
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
