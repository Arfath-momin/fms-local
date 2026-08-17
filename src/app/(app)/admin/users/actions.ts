"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

export type UserFormState =
  | { error: string }
  | { ok: string; password?: string }
  | null;

// Every action in this file is requireSuperAdmin(). User management is not an
// admin's job: an admin who can create accounts can mint another ADMIN, and an
// admin who can edit company grants can add themselves to books they were never
// given. Both were reachable before this, so the guard is the security boundary
// here and not a convenience — see canSuperAdminister() in lib/session.ts.
//
// SUPER_ADMIN is deliberately absent from the grantable list even so. The role
// is minted only by scripts/bootstrap.ts or scripts/create-user.ts, which need
// shell access to the server, so a stolen super-admin session still cannot
// manufacture a second permanent one. readRole() rejects anything not listed
// here, which closes the form-tampering route as well as the UI one.
const ROLES: Role[] = ["ADMIN", "ACCOUNTANT", "AUDITOR"];
const BCRYPT_COST = 12;

/** Ambiguous characters left out — these get read aloud and retyped. */
function generatePassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/**
 * Resolve a password field that is allowed to be blank.
 *
 * Blank means "generate a strong one and show it once"; filled means the admin
 * typed one deliberately, which is honoured above the length floor. Creating an
 * account and resetting one both offer that choice, so the rule lives here
 * rather than being written out twice and drifting apart.
 */
function readPassword(
  formData: FormData
): { error: string } | { password: string; generated: boolean } {
  const supplied = String(formData.get("password") ?? "");
  if (supplied && supplied.length < MIN_PASSWORD_LENGTH)
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  return supplied
    ? { password: supplied, generated: false }
    : { password: generatePassword(), generated: true };
}

function readRole(formData: FormData): Role | null {
  const raw = String(formData.get("role") ?? "");
  return (ROLES as string[]).includes(raw) ? (raw as Role) : null;
}

// The former assertMayActOn() guard is gone with the role change. It existed to
// stop an ADMIN reaching a SUPER_ADMIN's account — demoting them, resetting
// their password, signing in as them. No ADMIN reaches this file at all now, so
// the check could only ever compare a super admin against themselves.

export async function createUser(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireSuperAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = readRole(formData);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: "Enter a valid email address." };
  if (!name) return { error: "Enter a name." };
  if (!role) return { error: "Choose a role." };

  const pw = readPassword(formData);
  if ("error" in pw) return pw;
  const { password, generated } = pw;

  const companies = await readCompanies(formData);
  if ("error" in companies) return companies;

  try {
    await prisma.user.create({
      data: {
        email,
        name,
        role,
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        // Created with the account rather than granted afterwards, so a new
        // user is never briefly able to sign in and see nothing.
        companies: {
          create: companies.companyIds.map((companyId) => ({ companyId })),
        },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { error: "That email address is already in use." };
    throw e;
  }

  revalidatePath("/admin/users");
  // Only echo a password the admin has not seen. One they typed themselves
  // needs no repeating back at them on screen.
  return generated
    ? { ok: `Created ${email}.`, password }
    : { ok: `Created ${email}.` };
}

export async function setUserRole(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const admin = await requireSuperAdmin();

  const userId = String(formData.get("userId") ?? "");
  const role = readRole(formData);
  if (!role) return { error: "Choose a role." };

  // ROLES cannot express SUPER_ADMIN, so any self-change here is a demotion out
  // of a role only the shell can restore — and with it goes the only account
  // able to reach this screen. Refused outright.
  if (userId === admin.userId)
    return { error: "You cannot change your own role." };

  await prisma.user.update({ where: { id: userId }, data: { role } });
  revalidatePath("/admin/users");
  return { ok: "Role updated." };
}

export async function resetPassword(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireSuperAdmin();

  const userId = String(formData.get("userId") ?? "");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "That account no longer exists." };

  const pw = readPassword(formData);
  if ("error" in pw) return pw;
  const { password, generated } = pw;

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(password, BCRYPT_COST) },
  });

  revalidatePath("/admin/users");
  // A typed password is not echoed back — the admin chose it, and repeating it
  // on screen only leaves it sitting there for the next person walking past.
  return generated
    ? { ok: `New password for ${user.email}:`, password }
    : { ok: `Password updated for ${user.email}.` };
}

/**
 * Read the company checkboxes, refusing an empty set.
 *
 * An account with no company can sign in and then see nothing, which looks like
 * a broken app rather than a permissions decision. Deactivating someone is the
 * way to take their access away; leaving them with an empty company list is
 * not, so it is rejected at both ends of the flow.
 */
async function readCompanies(
  formData: FormData
): Promise<{ error: string } | { companyIds: string[] }> {
  const requested = formData.getAll("companyIds").map(String).filter(Boolean);
  if (requested.length === 0)
    return { error: "Choose at least one company for this account." };

  // Validated against the table so a tampered form cannot create a grant that
  // points nowhere and would silently never match.
  const known = await prisma.company.findMany({
    where: { id: { in: requested } },
    select: { id: true },
  });
  if (known.length !== requested.length)
    return { error: "One of those companies no longer exists." };

  return { companyIds: known.map((c) => c.id) };
}

/** Replace an account's company grants with exactly this set. */
export async function setUserCompanies(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireSuperAdmin();

  const userId = String(formData.get("userId") ?? "");

  const parsed = await readCompanies(formData);
  if ("error" in parsed) return parsed;

  // This action is the reason the whole screen moved to super admin. It sets a
  // company grant to an arbitrary set, and the old self-check only refused to
  // REMOVE the caller's own access — nothing stopped an admin ADDING one. An
  // admin granted BFM alone could therefore tick B2B against their own account
  // and walk into books they were never given, which is precisely the boundary
  // UserCompany exists to draw.
  //
  // No self-check is needed now: a super admin is never filtered by grants at
  // all (see getCompanies() in lib/company.ts), so editing their own row here
  // cannot lock them out of anything.

  // Delete-then-insert inside one transaction: the set is small and replacing
  // it wholesale is simpler to reason about than diffing, while the
  // transaction means a failure never leaves an account with no company.
  await prisma.$transaction([
    prisma.userCompany.deleteMany({
      where: { userId, companyId: { notIn: parsed.companyIds } },
    }),
    prisma.userCompany.createMany({
      data: parsed.companyIds.map((companyId) => ({ userId, companyId })),
      skipDuplicates: true,
    }),
  ]);

  revalidatePath("/admin/users");
  revalidatePath("/", "layout");
  return { ok: "Company access updated." };
}

export async function setUserActive(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const admin = await requireSuperAdmin();

  const userId = String(formData.get("userId") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "true";

  if (userId === admin.userId && !isActive)
    return { error: "You cannot deactivate your own account." };

  // Leaves at least one active account that can still edit a voucher. Note this
  // counts ADMIN too, which is intentionally weaker than "one active super
  // admin": deactivating the last super admin would strand user management, but
  // it cannot happen through here anyway, because the only role that reaches
  // this action is SUPER_ADMIN and the check above stops them deactivating
  // themselves. So the actor is always a surviving super admin.
  if (!isActive) {
    const otherAdmins = await prisma.user.count({
      where: {
        role: { in: ["SUPER_ADMIN", "ADMIN"] },
        isActive: true,
        id: { not: userId },
      },
    });
    if (otherAdmins === 0)
      return { error: "There must always be one active administrator." };
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { isActive },
  });

  revalidatePath("/admin/users");
  // getSession() re-reads the account on every request, so a deactivated user
  // is locked out immediately rather than when their cookie expires.
  return { ok: `${user.email} ${isActive ? "reactivated" : "deactivated"}.` };
}
