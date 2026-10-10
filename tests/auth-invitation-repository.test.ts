import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { users } from "@/lib/db/schema";

const { dbMock } = vi.hoisted(() => ({ dbMock: { transaction: vi.fn(), select: vi.fn() } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { invitationRepository } from "@/lib/auth/invitation-repository";

type InvitationFixture = {
  id: string;
  companyId: string;
  role: string;
  email: string;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

const now = new Date("2026-05-01T12:00:00.000Z");
const dialect = new PgDialect();
let fixtures: InvitationFixture[];
let whereExpression: SQL | undefined;
let insertValues: ReturnType<typeof vi.fn>;
let updateWhere: ReturnType<typeof vi.fn>;
let standaloneWhere: SQL | undefined;
let standaloneTable = "";
let userExists = false;
let activeMembershipExists = false;

function invitation(overrides: Partial<InvitationFixture> = {}): InvitationFixture {
  return {
    id: "invite-1",
    companyId: "company-1",
    role: "owner",
    email: "owner@example.com",
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date("2026-05-08T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  fixtures = [];
  whereExpression = undefined;
  standaloneWhere = undefined;
  standaloneTable = "";
  userExists = false;
  activeMembershipExists = false;
  insertValues = vi.fn(() => ({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }));
  updateWhere = vi.fn().mockResolvedValue([]);
  const selectBuilder: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    for: ReturnType<typeof vi.fn>;
  } = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
  };
  selectBuilder.from = vi.fn(() => selectBuilder);
  selectBuilder.where = vi.fn((where: SQL) => {
    whereExpression = where;
    return selectBuilder;
  });
  selectBuilder.for = vi.fn(async () => {
    const query = dialect.sqlToQuery(whereExpression!);
    expect(query.sql).toContain('"company_invitations"."email" = $1');
    expect(query.sql).toContain('"company_invitations"."accepted_at" is null');
    expect(query.sql).toContain('"company_invitations"."revoked_at" is null');
    expect(query.sql).toContain('"company_invitations"."expires_at" > $2');
    const [normalizedEmail, rawQueryTime] = query.params as [string, string | Date];
    const queryTime = rawQueryTime instanceof Date ? rawQueryTime : new Date(rawQueryTime);
    return fixtures.filter((row) =>
      row.email === normalizedEmail &&
      row.acceptedAt === null &&
      row.revokedAt === null &&
      row.expiresAt > queryTime,
    );
  });

  const transaction = {
    select: vi.fn(() => selectBuilder),
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
  };
  dbMock.transaction.mockImplementation((callback: (tx: typeof transaction) => unknown) => callback(transaction));

  const standaloneBuilder = {
    from: vi.fn((table: unknown) => {
      standaloneTable = getTableName(table as typeof users);
      return standaloneBuilder;
    }),
    where: vi.fn((where: SQL) => {
      standaloneWhere = where;
      return standaloneBuilder;
    }),
    limit: vi.fn(async (limit: number) => {
      const query = dialect.sqlToQuery(standaloneWhere!);
      if (standaloneTable === "company_invitations") {
        expect(query.sql).toContain('"company_invitations"."email" = $1');
        expect(query.sql).toContain('"company_invitations"."accepted_at" is null');
        expect(query.sql).toContain('"company_invitations"."revoked_at" is null');
        expect(query.sql).toContain('"company_invitations"."expires_at" > $2');
        const [normalizedEmail, rawQueryTime] = query.params as [string, string | Date];
        const queryTime = rawQueryTime instanceof Date ? rawQueryTime : new Date(rawQueryTime);
        return fixtures.filter((row) => row.email === normalizedEmail && row.acceptedAt === null && row.revokedAt === null && row.expiresAt > queryTime).slice(0, limit);
      }
      if (standaloneTable === "users") {
        expect(query.sql).toContain('"users"."id" = $1');
        return userExists ? [{ id: "authjs-user-id" }] : [];
      }
      if (standaloneTable === "company_memberships") {
        expect(query.sql).toContain('"company_memberships"."user_id" = $1');
        expect(query.sql).toContain('"company_memberships"."active" = $2');
        return activeMembershipExists ? [{ companyId: "company-1" }] : [];
      }
      throw new Error("Unexpected repository query table");
    }),
  };
  dbMock.select.mockImplementation(() => standaloneBuilder);
});

describe("pending invitation repository filters", () => {
  it("checks whether the Auth.js user has been persisted before enrollment", async () => {
    userExists = true;
    await expect(invitationRepository.hasUser("authjs-user-id")).resolves.toBe(true);
    userExists = false;
    await expect(invitationRepository.hasUser("authjs-user-id")).resolves.toBe(false);
  });

  it("allows pre-creation authorization only for one eligible exact-email invitation", async () => {
    fixtures = [invitation()];
    await expect(invitationRepository.hasEligibleInvitation("owner@example.com", now)).resolves.toBe(true);
    await expect(invitationRepository.hasEligibleInvitation("owner+alias@example.com", now)).resolves.toBe(false);
    await expect(invitationRepository.hasEligibleInvitation("owner@example.com", new Date("2026-05-09T00:00:00Z"))).resolves.toBe(false);
  });

  it("matches the exact normalized email and accepts an eligible invitation", async () => {
    fixtures = [invitation()];
    await expect(invitationRepository.acceptPendingInvitations("authjs-user-id", "owner@example.com", now)).resolves.toBe(1);
    expect(insertValues).toHaveBeenCalledWith({
      companyId: "company-1",
      userId: "authjs-user-id",
      role: "owner",
      active: true,
    });
    expect(updateWhere).toHaveBeenCalledOnce();
  });

  it("does not treat an email alias as an exact invitation match", async () => {
    fixtures = [invitation()];
    await expect(invitationRepository.acceptPendingInvitations("authjs-user-id", "owner+alias@example.com", now)).resolves.toBe(0);
    expect(insertValues).not.toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it.each([
    ["expired at the current instant", { expiresAt: now }],
    ["revoked", { revokedAt: new Date("2026-04-30T12:00:00.000Z") }],
    ["already accepted", { acceptedAt: new Date("2026-04-30T12:00:00.000Z") }],
  ])("does not accept an invitation that is %s", async (_description, fields) => {
    fixtures = [invitation(fields)];
    await expect(invitationRepository.acceptPendingInvitations("authjs-user-id", "owner@example.com", now)).resolves.toBe(0);
    expect(insertValues).not.toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
  });
});
