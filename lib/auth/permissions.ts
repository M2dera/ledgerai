import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, isDatabaseConfigured } from "@/lib/db";
import { companyMemberships } from "@/lib/db/schema";
import { CompanyPermissionError } from "./errors";

export type CompanyRole = "owner" | "accountant" | "approver" | "viewer";
export type CompanyPermission = "accounting:read" | "ai:use" | "accounting:prepare" | "accounting:approve" | "accounting:post" | "members:manage";

const rolePermissions: Record<CompanyRole, ReadonlySet<CompanyPermission>> = {
  owner: new Set(["accounting:read", "ai:use", "accounting:prepare", "accounting:approve", "accounting:post", "members:manage"]),
  accountant: new Set(["accounting:read", "ai:use", "accounting:prepare", "accounting:post"]),
  approver: new Set(["accounting:read", "ai:use", "accounting:approve"]),
  viewer: new Set(["accounting:read", "ai:use"]),
};

export function roleHasPermission(role: CompanyRole, permission: CompanyPermission): boolean {
  return rolePermissions[role].has(permission);
}

export type CompanyContext = { userId: string; companyId: string; role: CompanyRole };

export function resolveCompanyPermission(
  userId: string | null | undefined,
  memberships: Array<{ companyId: string; role: CompanyRole }>,
  permission: CompanyPermission,
): CompanyContext {
  if (!userId) throw new CompanyPermissionError("unauthenticated");
  if (memberships.length === 0) throw new CompanyPermissionError("forbidden");
  if (memberships.length !== 1) throw new CompanyPermissionError("company_context_unavailable");

  const membership = memberships[0];
  if (!roleHasPermission(membership.role, permission)) throw new CompanyPermissionError("forbidden");
  return { userId, companyId: membership.companyId, role: membership.role };
}

export async function requireCompanyPermission(permission: CompanyPermission): Promise<CompanyContext> {
  if (!isDatabaseConfigured() || !process.env.AUTH_SECRET?.trim() || !process.env.OIDC_ISSUER?.trim() || !process.env.OIDC_CLIENT_ID?.trim() || !process.env.OIDC_CLIENT_SECRET?.trim()) {
    throw new CompanyPermissionError("not_configured");
  }

  let session;
  try {
    session = await auth();
  } catch {
    throw new CompanyPermissionError("not_configured");
  }
  const userId = session?.user?.id;
  if (!userId) throw new CompanyPermissionError("unauthenticated");

  let memberships;
  try {
    memberships = await db
      .select({ companyId: companyMemberships.companyId, role: companyMemberships.role })
      .from(companyMemberships)
      .where(and(eq(companyMemberships.userId, userId), eq(companyMemberships.active, true)));
  } catch {
    throw new CompanyPermissionError("not_configured");
  }

  return resolveCompanyPermission(userId, memberships, permission);
}
