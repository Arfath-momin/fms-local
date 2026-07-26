"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireEntry } from "@/lib/session";
import { PARTY_TYPES } from "@/lib/party";
import type { PartyType } from "@/generated/prisma/enums";

export type PartyFormState = { error: string } | null;

type ParseResult =
  | { error: string }
  | { data: { name: string; type: PartyType; contactInfo: string | null } };

function parsePartyForm(formData: FormData): ParseResult {
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "") as PartyType;
  const contactInfo = String(formData.get("contactInfo") ?? "").trim();

  if (!name) return { error: "Party name is required." };
  if (!PARTY_TYPES.includes(type)) return { error: "Choose a party type." };

  return { data: { name, type, contactInfo: contactInfo || null } };
}

export async function createParty(
  _prev: PartyFormState,
  formData: FormData
): Promise<PartyFormState> {
  await requireEntry();
  const parsed = parsePartyForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  await prisma.party.create({ data: parsed.data });
  revalidatePath("/masters/parties");
  redirect("/masters/parties");
}

export async function updateParty(
  partyId: string,
  _prev: PartyFormState,
  formData: FormData
): Promise<PartyFormState> {
  await requireEntry();
  const parsed = parsePartyForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  await prisma.party.update({ where: { id: partyId }, data: parsed.data });
  revalidatePath("/masters/parties");
  redirect("/masters/parties");
}
