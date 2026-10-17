import Link from "next/link";
import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { canEdit, canEnter, canSuperAdminister, requireSession } from "@/lib/session";
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
  const mayEdit = canEdit(session.role);
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
  const groups = new Map<
    string,
    { id: string; name: string; vehicles: typeof vehicles }
  >();
  for (const vehicle of vehicles) {
    const group = groups.get(vehicle.transporter.id);
    if (group) {
      group.vehicles.push(vehicle);
    } else {
      groups.set(vehicle.transporter.id, {
        id: vehicle.transporter.id,
        name: vehicle.transporter.name,
        vehicles: [vehicle],
      });
    }
  }
  const transporterGroups = [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <div className="max-w-3xl">
      <h1 className="heading text-xl font-semibold mb-1">Vehicles</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · every trip names a vehicle, and the rent for that trip
        is owed to the transporter behind it.
      </p>

      {mayManage && (
        <div className="border border-line bg-surface px-4 py-3 mb-6">
          <h2 className="heading text-[15px] font-semibold mb-2">
            Add new vehicle
          </h2>
          <VehicleCreateForm transporters={transporters.map((t) => t.name)} />
        </div>
      )}

      {vehicles.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3">
          {company.name} has no vehicles yet.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th className="num-col">Trips</th>
                <th>Added</th>
                {mayManage && <th className="w-32"></th>}
              </tr>
            </thead>
            <tbody>
              {transporterGroups.map((group) => (
                <Fragment key={group.id}>
                  <tr className="bg-surface-muted">
                    <td
                      colSpan={mayManage ? 4 : 3}
                      className="font-semibold"
                    >
                      <Link
                        href={`/ledgers/parties/${group.id}`}
                        className="text-accent underline underline-offset-2"
                      >
                        {group.name}
                      </Link>
                      <span className="text-muted text-[12px] font-normal ml-2">
                        {group.vehicles.length} vehicle
                        {group.vehicles.length === 1 ? "" : "s"}
                      </span>
                    </td>
                  </tr>
                  {group.vehicles.map((v) => (
                    <tr
                      key={v.id}
                      className={v.archivedAt ? "opacity-50" : ""}
                    >
                      <td className="font-medium num pl-8">
                        <Link
                          href={`/ledgers/expenses/rent?vehicleId=${v.id}`}
                          className="text-accent underline underline-offset-2"
                        >
                          {v.number}
                        </Link>
                        {v.archivedAt && (
                          <span className="text-muted text-[12px] normal-case">
                            {" "}
                            · archived
                          </span>
                        )}
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
                            mayEdit={mayEdit}
                            transporterName={v.transporter.name}
                            transporters={transporters.map((t) => t.name)}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
