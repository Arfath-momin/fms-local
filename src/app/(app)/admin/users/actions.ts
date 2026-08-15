"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { canAdminister, requireAdmin } from "@/lib/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

export type UserFormState =
  | { error: string }
  | { ok: string; password?: string }
  | null;

// SUPER_ADMIN is deliberately absent: it is the role that can undo an admin's
// housekeeping and delete masters outright, so it must not be grantable by the
// people it exists to sit above. readRole() rejects anything not listed here,
// which closes the form-tampering route as well as the UI one. The only way to
// mint one is scripts/create-user.ts, which needs shell access to the server.
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

/**
 * Guards every action that acts *on* an existing account.
 *
 * Blocking the granting of SUPER_ADMIN is only half the job — without this, an
 * admin could demote the super admin to ADMIN, deactivate them, or simply reset
 * their password and sign in as them, and any one of those hands over the role
 * they were never allowed to be given. A super admin's account is therefore
 * editable only by a super admin.
 */
async function assertMayActOn(
  actor: Role,
  userId: string
): Promise<{ error: string } | null> {
  if (actor === "SUPER_ADMIN") return null;
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (target?.role === "SUPER_ADMIN")
    return { error: "That account can only be changed by the system owner." };
  return null;
}

export async function createUser(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireAdmin();

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

  try {
    await prisma.user.create({
      data: {
        email,
        name,
        role,
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
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
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const role = readRole(formData);
  if (!role) return { error: "Choose a role." };

  const blocked = await assertMayActOn(admin.role, userId);
  if (blocked) return blocked;

  // Losing the last admin would leave nobody able to manage users or edit a
  // voucher, recoverable only from the server. The same applies a tier up: the
  // role list here cannot express SUPER_ADMIN, so any self-change by one is a
  // demotion out of a role only the shell can restore.
  if (userId === admin.userId && admin.role === "SUPER_ADMIN")
    return { error: "You cannot change your own role." };
  if (userId === admin.userId && !canAdminister(role))
    return { error: "You cannot remove your own admin rights." };

  await prisma.user.update({ where: { id: userId }, data: { role } });
  revalidatePath("/admin/users");
  return { ok: "Role updated." };
}

export async function resetPassword(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const blocked = await assertMayActOn(admin.role, userId);
  if (blocked) return blocked;

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

export async function setUserActive(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "true";

  const blocked = await assertMayActOn(admin.role, userId);
  if (blocked) return blocked;

  if (userId === admin.userId && !isActive)
    return { error: "You cannot deactivate your own account." };

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
