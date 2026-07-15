import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { createParty } from "../actions";
import { PartyForm } from "../party-form";

export default async function NewPartyPage() {
  const session = await requireSession();
  if (session.role !== "MERCHANT") redirect("/masters/parties");

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">New Party</h1>
      <PartyForm action={createParty} submitLabel="Create Party" />
    </div>
  );
}
