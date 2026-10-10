import { evaluateInvitedIdentity, normalizeEmail, type InvitationEnrollmentRepository, type SignInDenialReason } from "./enrollment";

type AuthJsSignInArguments = {
  user: { id?: string | null; email?: string | null };
  profile?: unknown;
};

export function reportSignInDenial(reason: SignInDenialReason): void {
  if (process.env.NODE_ENV === "development") {
    console.warn(reason);
  }
}

export function createIdentitySignInCallback({
  isConfigured,
  repository,
  onDenial = reportSignInDenial,
}: {
  isConfigured: () => boolean;
  repository: InvitationEnrollmentRepository;
  onDenial?: (reason: SignInDenialReason) => void;
}) {
  return async ({ user, profile }: AuthJsSignInArguments): Promise<boolean> => {
    if (!isConfigured()) {
      onDenial("identity_configuration_missing");
      return false;
    }

    const emailVerified =
      typeof profile === "object" && profile !== null && "email_verified" in profile
        ? profile.email_verified
        : undefined;

    const result = await evaluateInvitedIdentity({
      userId: user?.id,
      email: user?.email,
      emailVerified,
      repository,
    });

    if (!result.allowed) {
      onDenial(result.reason);
      return false;
    }
    return true;
  };
}

export function createIdentityUserCreatedHandler({
  repository,
  onDenial = reportSignInDenial,
}: {
  repository: InvitationEnrollmentRepository;
  onDenial?: (reason: SignInDenialReason) => void;
}) {
  return async ({ user }: { user: { id?: string | null; email?: string | null } }): Promise<void> => {
    if (typeof user?.id !== "string" || !user.id.trim()) {
      onDenial("user_id_missing");
      throw new Error("Invitation enrollment failed");
    }

    const email = normalizeEmail(user.email);
    if (!email) {
      onDenial("email_invalid_or_missing");
      throw new Error("Invitation enrollment failed");
    }

    try {
      const accepted = await repository.acceptPendingInvitations(user.id, email, new Date());
      if (accepted > 0 || await repository.hasActiveMembership(user.id)) return;
      onDenial("invitation_or_membership_not_found");
    } catch {
      onDenial("invitation_lookup_error");
    }
    // Do not surface database errors through Auth.js logs or create a session
    // when invitation enrollment did not complete.
    throw new Error("Invitation enrollment failed");
  };
}
