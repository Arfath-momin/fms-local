import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { canEnter, requireSession } from "@/lib/session";
import { updateParty } from "../actions";
import { PartyForm } from "../party-form";

export default async function EditPartyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/masters/parties");

  const { id } = await params;
  const party = await prisma.party.findUnique({ where: { id } });
  if (!party) notFound();

  const action = updateParty.bind(null, party.id);

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Party</h1>
      <PartyForm
        action={action}
        initial={{
          name: party.name,
          type: party.type,
          contactInfo: party.contactInfo,
        }}
        submitLabel="Save Changes"
      />
    </div>
  );
}
