import Link from "next/link";
import { prisma } from "@/lib/db";
import { canEnter, canSuperAdminister, requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { fmtDate } from "@/lib/format";
import { VehicleCreateForm } from "./vehicle-create-form";
import { VehicleActionsCell } from "./vehicle-actions-cell";

/**
 * The vehicle master.
 *
 * Vehicles were free text on the delivery note, which meant the same truck
 * spelled three ways was three trucks and none of them pointed at anyone to owe
 * rent to. Here every truck is a row with a transporter behind it, and a trip's
 * rent reaches that transporter's ledger through it.
 */
export default async function VehiclesPage() {
  const session = await requireSession();
  const mayManage = canEnter(session.role);
  const isSuperAdmin = canSuperAdminister(session.role);
  const company = await getActiveCompany();

  // Archived vehicles are listed here, unlike in the trip picker — this is the
  // one screen where you need to see what was retired in order to manage it.
  const [vehicles, transporters] = await Promise.all([
    prisma.vehicle.findMany({
      where: { companyId: company.id },
      // Live first: Postgres sorts NULLs last on ASC, and archived_at is NULL
      // for exactly the rows that belong at the top.
      orderBy: [
        { archivedAt: { sort: "asc", nulls: "first" } },
        { number: "asc" },
      ],
      include: {
        transporter: { select: { id: true, name: true } },
        _count: { select: { trips: true } },
      },
    }),
    prisma.party.findMany({
      where: { type: "TRANSPORTER", archivedAt: null },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="heading text-xl font-semibold mb-1">Vehicles</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · every trip names a vehicle, and the rent for that trip
        is owed to the transporter behind it.
      </p>

      {vehicles.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 mb-4">
          {company.name} has no vehicles yet. Add the first one below.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface mb-4 overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Transporter</th>
                <th className="num-col">Trips</th>
                <th>Added</th>
                {mayManage && <th className="w-32"></th>}
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} className={v.archivedAt ? "opacity-50" : ""}>
                  <td className="font-medium num">
                    {v.number}
                    {v.archivedAt && (
                      <span className="text-muted text-[12px] normal-case">
                        {" "}
                        · archived
                      </span>
                    )}
                  </td>
                  <td>
                    {/* Straight to the transporter's statement — the balance
                        there is the rent still unpaid across every trip. */}
                    <Link
                      href={`/ledgers/parties/${v.transporter.id}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {v.transporter.name}
                    </Link>
                  </td>
                  <td className="num-col num">{v._count.trips}</td>
                  <td className="text-muted text-[12px]">
                    {fmtDate(v.createdAt)}
                  </td>
                  {mayManage && (
                    <td>
                      <VehicleActionsCell
                        vehicleId={v.id}
                        number={v.number}
                        archived={v.archivedAt !== null}
                        trips={v._count.trips}
                        isSuperAdmin={isSuperAdmin}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mayManage && (
        <div className="border border-line bg-surface px-4 py-3">
          <VehicleCreateForm transporters={transporters.map((t) => t.name)} />
        </div>
      )}
    </div>
  );
}
