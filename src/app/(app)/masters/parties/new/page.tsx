import { redirect } from "next/navigation";
import type { PartyType } from "@/generated/prisma/enums";
import { canEnter, requireSession } from "@/lib/session";
import { PARTY_TYPES, PARTY_TYPE_LABELS } from "@/lib/party";
import { createParty } from "../actions";
import { PartyForm } from "../party-form";

export default async function NewPartyPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/masters/parties");

  const rawType = (await searchParams).type as PartyType | undefined;
  const type = rawType && PARTY_TYPES.includes(rawType) ? rawType : null;

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">
        New {type ? PARTY_TYPE_LABELS[type] : "Party"}
      </h1>
      <PartyForm
        action={createParty}
        initial={
          type ? { name: "", type, contactInfo: null } : undefined
        }
        submitLabel={`Create ${type ? PARTY_TYPE_LABELS[type] : "Party"}`}
      />
    </div>
  );
}
