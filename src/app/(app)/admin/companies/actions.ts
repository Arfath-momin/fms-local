"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { isCompanyColour } from "@/lib/company-theme";
import { stageAttachmentFile, validateImageFile } from "@/lib/attachments";

export type CompanyFormState = { error: string } | { ok: string } | null;

type Fields = {
  name: string;
  colour: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  contactPerson: string | null;
  gstin: string | null;
};

const clean = (v: FormDataEntryValue | null) =>
  String(v ?? "").trim().replace(/[ \t]+/g, " ");

function parse(formData: FormData): { error: string } | { data: Fields } {
  // The short name is what the switcher and the company band show, so it has to
  // stay short enough to read in a chip — the full registered name goes in
  // `legalName` and prints on documents instead.
  const name = clean(formData.get("name"));
  if (!name) return { error: "Enter the company's short name." };
  if (name.length > 24)
    return {
      error:
        "The short name is limited to 24 characters — it has to fit the " +
        "switcher. Put the full registered name in Legal Name.",
    };

  const colour = clean(formData.get("colour"));
  if (!isCompanyColour(colour))
    return { error: "Choose one of the offered colours." };

  const email = clean(formData.get("email"));
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: "That email address does not look right." };

  const optional = (key: string) => clean(formData.get(key)) || null;

  return {
    data: {
      name,
      colour,
      legalName: optional("legalName"),
      // Newlines are meaningful in an address, so only runs of spaces and tabs
      // are collapsed above — never the line breaks.
      address: String(formData.get("address") ?? "").trim() || null,
      phone: optional("phone"),
      email: email || null,
      contactPerson: optional("contactPerson"),
      gstin: optional("gstin")?.toUpperCase() ?? null,
    },
  };
}

/**
 * Stage a logo, if one was chosen.
 *
 * Reuses the bill-image pipeline: the same size and type limits, the same
 * magic-byte sniff, the same on-disk store. It is written before the row is
 * updated so a rejected image fails the save outright rather than leaving a
 * company pointing at a file that was never written.
 */
async function stageLogo(formData: FormData): Promise<string | null> {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return null;
  const bad = validateImageFile(file);
  if (bad) throw new Error(bad);
  const staged = await stageAttachmentFile(file);
  return staged?.storageKey ?? null;
}

/**
 * Add a company. Super admin only — deliberately not something the merchant's
 * own admin can do, because a company is the top-level boundary every other
 * permission is expressed against.
 */
export async function createCompany(
  _prev: CompanyFormState,
  formData: FormData
): Promise<CompanyFormState> {
  await requireSuperAdmin();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };

  try {
    const logoKey = await stageLogo(formData);
    await prisma.company.create({ data: { ...parsed.data, logoKey } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { error: `A company called “${parsed.data.name}” already exists.` };
    return {
      error: e instanceof Error ? e.message : "Could not add the company.",
    };
  }

  // The layout renders the switcher and the band, so it has to rebuild too.
  revalidatePath("/", "layout");
  return { ok: `${parsed.data.name} added.` };
}

/** Update a company's name, colour and letterhead. Super admin only. */
export async function updateCompany(
  companyId: string,
  _prev: CompanyFormState,
  formData: FormData
): Promise<CompanyFormState> {
  await requireSuperAdmin();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };

  try {
    const logoKey = await stageLogo(formData);
    await prisma.company.update({
      where: { id: companyId },
      // A new logo replaces the old one; leaving the field empty keeps
      // whatever is there, which is what makes editing the phone number not
      // silently drop the logo.
      data: { ...parsed.data, ...(logoKey ? { logoKey } : {}) },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { error: `A company called “${parsed.data.name}” already exists.` };
    return {
      error: e instanceof Error ? e.message : "Could not save the company.",
    };
  }

  revalidatePath("/", "layout");
  return { ok: "Saved." };
}

/** Drop the logo, returning the letterhead to the company name alone. */
export async function removeCompanyLogo(
  companyId: string,
  _prev: CompanyFormState,
  _formData: FormData
): Promise<CompanyFormState> {
  await requireSuperAdmin();
  // The file is deliberately left on disk. An orphaned image is invisible and
  // harmless, whereas deleting it would destroy the only copy the moment
  // someone clears a logo by accident.
  await prisma.company.update({
    where: { id: companyId },
    data: { logoKey: null },
  });
  revalidatePath("/", "layout");
  return { ok: "Logo removed." };
}

/**
 * Delete a company outright. Super admin only, and refused the moment anything
 * belongs to it — the same rule centres and parties follow. A company with a
 * single voucher can never be deleted, because everything in the books hangs
 * off it.
 */
export async function deleteCompany(
  companyId: string,
  _prev: CompanyFormState,
  _formData: FormData
): Promise<CompanyFormState> {
  await requireSuperAdmin();

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true,
      _count: {
        select: {
          centres: true,
          purchases: true,
          sales: true,
          expenses: true,
          deliveryNotes: true,
          settlements: true,
          ledgerEntries: true,
          attachments: true,
          reviewRequests: true,
        },
      },
    },
  });
  if (!company) return { error: "That company no longer exists." };

  const refs = Object.values(company._count).reduce((a, b) => a + b, 0);
  if (refs > 0)
    return {
      error:
        `${company.name} holds ${refs} record${refs === 1 ? "" : "s"} — ` +
        `centres, vouchers or ledger entries — and cannot be deleted.`,
    };

  const remaining = await prisma.company.count({ where: { id: { not: companyId } } });
  if (remaining === 0)
    return {
      error:
        "This is the only company. Deleting it would leave nobody able to " +
        "use the app, since a company cannot be created from any other screen.",
    };

  // Grants are the one thing that legitimately points at an unused company;
  // they cascade, and carry no history worth keeping.
  await prisma.company.delete({ where: { id: companyId } });
  revalidatePath("/", "layout");
  return { ok: `${company.name} deleted.` };
}
