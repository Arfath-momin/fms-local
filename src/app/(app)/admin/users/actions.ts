"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export type UserFormState =
  | { error: string }
  | { ok: string; password?: string }
  | null;

const ROLES: Role[] = ["ADMIN", "ACCOUNTANT", "AUDITOR"];
const MIN_PASSWORD_LENGTH = 12;
const BCRYPT_COST = 12;

/** Ambiguous characters left out — these get read aloud and retyped. */
function generatePassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

function readRole(formData: FormData): Role | null {
  const raw = String(formData.get("role") ?? "");
  return (ROLES as string[]).includes(raw) ? (raw as Role) : null;
}

export async function createUser(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = readRole(formData);
  const supplied = String(formData.get("password") ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: "Enter a valid email address." };
  if (!name) return { error: "Enter a name." };
  if (!role) return { error: "Choose a role." };
  if (supplied && supplied.length < MIN_PASSWORD_LENGTH)
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };

  const password = supplied || generatePassword();

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
  return supplied
    ? { ok: `Created ${email}.` }
    : { ok: `Created ${email}.`, password };
}

export async function setUserRole(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const role = readRole(formData);
  if (!role) return { error: "Choose a role." };

  // Losing the last admin would leave nobody able to manage users or edit a
  // voucher, recoverable only from the server.
  if (userId === admin.userId && role !== "ADMIN")
    return { error: "You cannot remove your own admin rights." };

  await prisma.user.update({ where: { id: userId }, data: { role } });
  revalidatePath("/admin/users");
  return { ok: "Role updated." };
}

export async function resetPassword(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "That account no longer exists." };

  const password = generatePassword();
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(password, BCRYPT_COST) },
  });

  revalidatePath("/admin/users");
  return { ok: `New password for ${user.email}:`, password };
}

export async function setUserActive(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "true";

  if (userId === admin.userId && !isActive)
    return { error: "You cannot deactivate your own account." };

  if (!isActive) {
    const otherAdmins = await prisma.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: userId } },
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
