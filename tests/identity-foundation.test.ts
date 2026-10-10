import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { accounts, companies, companyInvitations, companyMemberships, sessions, users, verificationTokens } from "@/lib/db/schema";
import { createOidcProvider, isIdentityConfigured } from "@/lib/auth/config";
import { evaluateInvitedIdentity } from "@/lib/auth/enrollment";
import { CompanyPermissionError, permissionErrorResponse } from "@/lib/auth/errors";
import { resolveCompanyPermission, roleHasPermission, requireCompanyPermission } from "@/lib/auth/permissions";

const membershipQuery = {
  from: vi.fn(),
  where: vi.fn(),
};
membershipQuery.from.mockReturnValue(membershipQuery);

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
  db: { select: vi.fn(() => membershipQuery) },
}));

describe("identity foundation schema and migrations", () => {
  it("defines Auth.js identity/session tables and company membership/invitation constraints", () => {
    expect(getTableConfig(users).name).toBe("users");
    expect(getTableConfig(accounts).foreignKeys).toHaveLength(1);
    expect(getTableConfig(sessions).foreignKeys).toHaveLength(1);
    expect(getTableConfig(verificationTokens).primaryKeys).toHaveLength(1);
    expect(getTableConfig(companies).columns.some((column) => column.name === "id")).toBe(true);
    expect(getTableConfig(companyMemberships).primaryKeys).toHaveLength(1);
    expect(getTableConfig(companyMemberships).foreignKeys).toHaveLength(2);
    expect(getTableConfig(companyInvitations).foreignKeys).toHaveLength(2);
    expect(getTableConfig(companyInvitations).indexes.some((index) => index.config.unique)).toBe(true);
    expect(getTableConfig(companyInvitations).checks).toHaveLength(1);
  });

  it("has a versioned migration covering the required tables and foreign keys", () => {
    const migrationPath = readdirSync(resolve(process.cwd(), "drizzle"))
      .find((file) => /^\d+_.+\.sql$/.test(file));
    expect(migrationPath).toBeDefined();
    const migration = readFileSync(resolve(process.cwd(), "drizzle", migrationPath!), "utf8");
    for (const table of ["users", "accounts", "sessions", "verification_tokens", "companies", "company_memberships", "company_invitations"]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toContain("REFERENCES \"public\".\"users\"");
    expect(migration).toContain("REFERENCES \"public\".\"companies\"");
    expect(migration).toContain("company_invitations_email_normalized");
    expect(readFileSync(resolve(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")).toContain('"dialect": "postgresql"');
  });
});

describe("OIDC configuration and invitation enrollment", () => {
  const configured = {
    AUTH_SECRET: "test-only-secret",
    DATABASE_URL: "postgres://test",
    OIDC_ISSUER: "https://identity.example.test",
    OIDC_CLIENT_ID: "test-client",
    OIDC_CLIENT_SECRET: "test-secret",
  };

  it("requires all server-side settings and builds a generic OIDC provider without hardcoded credentials", () => {
    expect(isIdentityConfigured(configured)).toBe(true);
    expect(isIdentityConfigured({ ...configured, OIDC_CLIENT_SECRET: " " })).toBe(false);
    expect(createOidcProvider(configured)).toEqual({
      id: "oidc",
      name: "Organization sign-in",
      type: "oidc",
      issuer: configured.OIDC_ISSUER,
      clientId: configured.OIDC_CLIENT_ID,
      clientSecret: configured.OIDC_CLIENT_SECRET,
    });
    expect(createOidcProvider({})).toBeNull();
  });

  it("accepts only a verified identity matching a pending invitation or existing membership", async () => {
    const repository = {
      hasUser: vi.fn().mockResolvedValue(true),
      hasEligibleInvitation: vi.fn().mockResolvedValue(false),
      acceptPendingInvitations: vi.fn().mockResolvedValue(1),
      hasActiveMembership: vi.fn().mockResolvedValue(false),
    };
    await expect(evaluateInvitedIdentity({ userId: "u-1", email: " OWNER@EXAMPLE.COM ", emailVerified: true, repository, now: new Date("2026-01-01T00:00:00Z") })).resolves.toEqual({ allowed: true });
    expect(repository.acceptPendingInvitations).toHaveBeenCalledWith("u-1", "owner@example.com", new Date("2026-01-01T00:00:00Z"));

    repository.acceptPendingInvitations.mockClear();
    await expect(evaluateInvitedIdentity({ userId: "u-2", email: "owner@example.com", emailVerified: false, repository })).resolves.toEqual({ allowed: false, reason: "verified_email_claim_missing_false_or_non_boolean" });
    expect(repository.acceptPendingInvitations).not.toHaveBeenCalled();

    repository.acceptPendingInvitations.mockResolvedValue(0);
    repository.hasActiveMembership.mockResolvedValue(true);
    await expect(evaluateInvitedIdentity({ userId: "u-3", email: "member@example.com", emailVerified: true, repository })).resolves.toEqual({ allowed: true });
    repository.hasActiveMembership.mockResolvedValue(false);
    await expect(evaluateInvitedIdentity({ userId: "u-4", email: "new@example.com", emailVerified: true, repository })).resolves.toEqual({ allowed: false, reason: "invitation_or_membership_not_found" });
  });

  it("fails closed when invitation or membership storage fails", async () => {
    const repository = {
      hasUser: vi.fn().mockResolvedValue(true),
      hasEligibleInvitation: vi.fn().mockResolvedValue(false),
      acceptPendingInvitations: vi.fn().mockRejectedValue(new Error("database down")),
      hasActiveMembership: vi.fn(),
    };
    await expect(evaluateInvitedIdentity({ userId: "u-1", email: "owner@example.com", emailVerified: true, repository })).resolves.toEqual({ allowed: false, reason: "invitation_lookup_error" });
    expect(repository.hasActiveMembership).not.toHaveBeenCalled();
  });
});

describe("server-side company permission boundary", () => {
  let authMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "test-only-secret";
    process.env.DATABASE_URL = "postgres://test";
    process.env.OIDC_ISSUER = "https://identity.example.test";
    process.env.OIDC_CLIENT_ID = "test-client";
    process.env.OIDC_CLIENT_SECRET = "test-secret";
    membershipQuery.where.mockResolvedValue([{ companyId: "company-db", role: "accountant" }]);
    const { auth } = await import("@/auth");
    authMock = auth as unknown as ReturnType<typeof vi.fn>;
  });

  it("rejects unauthenticated callers and members without an active company membership", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireCompanyPermission("accounting:read")).rejects.toMatchObject({ code: "unauthenticated" });

    authMock.mockResolvedValue({ user: { id: "user-from-session" }, expires: "2099-01-01" });
    membershipQuery.where.mockResolvedValueOnce([]);
    await expect(requireCompanyPermission("accounting:read")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("resolves company and role from the authenticated session and database, not request data", async () => {
    authMock.mockResolvedValue({ user: { id: "session-user" }, expires: "2099-01-01" });
    const context = await requireCompanyPermission("accounting:read");
    expect(context).toEqual({ userId: "session-user", companyId: "company-db", role: "accountant" });
    expect(membershipQuery.where).toHaveBeenCalledOnce();
    expect(requireCompanyPermission).toHaveLength(1);
  });

  it("applies least-privilege role permissions and denies ambiguous company context", () => {
    expect(roleHasPermission("owner", "members:manage")).toBe(true);
    expect(roleHasPermission("accountant", "accounting:post")).toBe(true);
    expect(roleHasPermission("accountant", "accounting:approve")).toBe(false);
    expect(roleHasPermission("approver", "accounting:approve")).toBe(true);
    expect(roleHasPermission("approver", "accounting:post")).toBe(false);
    expect(roleHasPermission("viewer", "accounting:read")).toBe(true);
    expect(roleHasPermission("viewer", "accounting:prepare")).toBe(false);
    expect(() => resolveCompanyPermission("u-1", [
      { companyId: "a", role: "owner" }, { companyId: "b", role: "viewer" },
    ], "accounting:read")).toThrowError(CompanyPermissionError);
  });

  it("returns service-unavailable on database or identity configuration failure", async () => {
    authMock.mockResolvedValue({ user: { id: "session-user" }, expires: "2099-01-01" });
    membershipQuery.where.mockRejectedValueOnce(new Error("database down"));
    await expect(requireCompanyPermission("accounting:read")).rejects.toMatchObject({ code: "not_configured" });
    expect(permissionErrorResponse(new CompanyPermissionError("not_configured")).status).toBe(503);

    delete process.env.OIDC_CLIENT_SECRET;
    await expect(requireCompanyPermission("accounting:read")).rejects.toMatchObject({ code: "not_configured" });
  });
});

describe("session-only accounting stays unchanged", () => {
  it("keeps accounting state in the shared in-memory provider with no database import or persistence", () => {
    const provider = readFileSync(resolve(process.cwd(), "components/providers/AccountingSessionProvider.tsx"), "utf8");
    expect(provider).toContain("createChatState");
    expect(provider).toContain("useState");
    expect(provider).not.toMatch(/localStorage|sessionStorage|@\/lib\/db|fetch\(/);
  });
});
