import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentitySignInCallback, createIdentityUserCreatedHandler, reportSignInDenial } from "@/lib/auth/sign-in-callback";
import type { InvitationEnrollmentRepository, SignInDenialReason } from "@/lib/auth/enrollment";

const googleProfile = {
  sub: "google-subject",
  email: "owner@example.com",
  email_verified: true,
  name: "Test User",
};

function createRepository(overrides: Partial<InvitationEnrollmentRepository> = {}): InvitationEnrollmentRepository {
  return {
    hasUser: vi.fn().mockResolvedValue(true),
    hasEligibleInvitation: vi.fn().mockResolvedValue(false),
    acceptPendingInvitations: vi.fn().mockResolvedValue(1),
    hasActiveMembership: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function createCallback({
  configured = true,
  repository = createRepository(),
  onDenial = vi.fn(),
}: {
  configured?: boolean;
  repository?: InvitationEnrollmentRepository;
  onDenial?: (reason: SignInDenialReason) => void;
} = {}) {
  return {
    callback: createIdentitySignInCallback({
      isConfigured: () => configured,
      repository,
      onDenial,
    }),
    repository,
    onDenial,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Auth.js OIDC sign-in callback", () => {
  it("uses Auth.js user fields and the raw Google OIDC profile without weakening verification", async () => {
    const repository = createRepository();
    const { callback, onDenial } = createCallback({ repository });
    const authJsUserId = "authjs-generated-user-id";

    await expect(callback({
      user: { id: authJsUserId, email: " OWNER@EXAMPLE.COM " },
      profile: googleProfile,
    })).resolves.toBe(true);

    expect(repository.acceptPendingInvitations).toHaveBeenCalledWith(
      authJsUserId,
      "owner@example.com",
      expect.any(Date),
    );
    expect(repository.acceptPendingInvitations).not.toHaveBeenCalledWith(
      googleProfile.sub,
      expect.any(String),
      expect.any(Date),
    );
    expect(onDenial).not.toHaveBeenCalled();
  });

  it("allows a first-time OAuth user only after a read-only eligible-invitation check, then enrolls after user creation", async () => {
    const repository = createRepository({
      hasUser: vi.fn().mockResolvedValue(false),
      hasEligibleInvitation: vi.fn().mockResolvedValue(true),
    });
    const { callback } = createCallback({ repository });
    await expect(callback({
      user: { id: "provider-subject", email: " OWNER@EXAMPLE.COM " },
      profile: googleProfile,
    })).resolves.toBe(true);
    expect(repository.hasEligibleInvitation).toHaveBeenCalledWith("owner@example.com", expect.any(Date));
    expect(repository.acceptPendingInvitations).not.toHaveBeenCalled();

    const onDenial = vi.fn();
    const onUserCreated = createIdentityUserCreatedHandler({ repository, onDenial });
    await expect(onUserCreated({ user: { id: "provider-subject", email: " OWNER@EXAMPLE.COM " } })).resolves.toBeUndefined();
    expect(repository.acceptPendingInvitations).toHaveBeenCalledWith("provider-subject", "owner@example.com", expect.any(Date));
    expect(onDenial).not.toHaveBeenCalled();
  });

  it("fails closed with a sanitized reason if invitation enrollment fails after user creation", async () => {
    const repository = createRepository({
      acceptPendingInvitations: vi.fn().mockRejectedValue(new Error("private database details")),
    });
    const onDenial = vi.fn();
    const onUserCreated = createIdentityUserCreatedHandler({ repository, onDenial });

    await expect(onUserCreated({ user: { id: "u-1", email: "owner@example.com" } }))
      .rejects.toThrow("Invitation enrollment failed");
    expect(onDenial).toHaveBeenCalledExactlyOnceWith("invitation_lookup_error");
    expect(onDenial).not.toHaveBeenCalledWith(expect.stringContaining("private database details"));
  });

  it("returns a distinct reason for missing identity configuration, user ID, or valid email", async () => {
    const { callback: unconfigured, onDenial: configDenied } = createCallback({ configured: false });
    await expect(unconfigured({ user: { id: "u-1", email: "owner@example.com" }, profile: googleProfile })).resolves.toBe(false);
    expect(configDenied).toHaveBeenCalledWith("identity_configuration_missing");

    for (const [user, reason] of [
      [{ email: "owner@example.com" }, "user_id_missing"],
      [{ id: "  ", email: "owner@example.com" }, "user_id_missing"],
      [{ id: "u-1", email: undefined }, "email_invalid_or_missing"],
      [{ id: "u-1", email: "not-an-email" }, "email_invalid_or_missing"],
    ] as const) {
      const { callback, onDenial, repository } = createCallback();
      await expect(callback({ user, profile: googleProfile })).resolves.toBe(false);
      expect(onDenial).toHaveBeenCalledWith(reason);
      expect(repository.acceptPendingInvitations).not.toHaveBeenCalled();
    }
  });

  it.each([
    [undefined, "verified_email_claim_missing_false_or_non_boolean"],
    [false, "verified_email_claim_missing_false_or_non_boolean"],
    ["true", "verified_email_claim_missing_false_or_non_boolean"],
    [1, "verified_email_claim_missing_false_or_non_boolean"],
  ])("denies unless profile.email_verified is boolean true (%s)", async (emailVerified, reason) => {
    const repository = createRepository();
    const { callback, onDenial } = createCallback({ repository });
    const profile = { ...googleProfile, email_verified: emailVerified };

    await expect(callback({ user: { id: "u-1", email: "owner@example.com" }, profile })).resolves.toBe(false);
    expect(onDenial).toHaveBeenCalledWith(reason);
    expect(repository.acceptPendingInvitations).not.toHaveBeenCalled();
  });

  it("distinguishes no eligible invitation or active membership from lookup errors", async () => {
    const noMatch = createRepository({
      acceptPendingInvitations: vi.fn().mockResolvedValue(0),
      hasActiveMembership: vi.fn().mockResolvedValue(false),
    });
    const { callback: noMatchCallback, onDenial: noMatchDenied } = createCallback({ repository: noMatch });
    await expect(noMatchCallback({ user: { id: "u-1", email: "owner@example.com" }, profile: googleProfile })).resolves.toBe(false);
    expect(noMatchDenied).toHaveBeenCalledWith("invitation_or_membership_not_found");

    const lookupFailure = createRepository({
      acceptPendingInvitations: vi.fn().mockRejectedValue(new Error("private database error")),
    });
    const { callback: failureCallback, onDenial: failureDenied } = createCallback({ repository: lookupFailure });
    await expect(failureCallback({ user: { id: "u-1", email: "owner@example.com" }, profile: googleProfile })).resolves.toBe(false);
    expect(failureDenied).toHaveBeenCalledWith("invitation_lookup_error");
    expect(failureDenied).not.toHaveBeenCalledWith(expect.stringContaining("private database error"));
  });

  it("logs only the reason code in development and is silent outside development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "development");
    reportSignInDenial("email_invalid_or_missing");
    expect(warn).toHaveBeenCalledExactlyOnceWith("email_invalid_or_missing");

    warn.mockClear();
    vi.stubEnv("NODE_ENV", "production");
    reportSignInDenial("invitation_lookup_error");
    expect(warn).not.toHaveBeenCalled();
  });
});
