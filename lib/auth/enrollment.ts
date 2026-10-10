export type InvitationEnrollmentRepository = {
  hasUser: (userId: string) => Promise<boolean>;
  hasEligibleInvitation: (normalizedEmail: string, now: Date) => Promise<boolean>;
  acceptPendingInvitations: (userId: string, normalizedEmail: string, now: Date) => Promise<number>;
  hasActiveMembership: (userId: string) => Promise<boolean>;
};

export type SignInDenialReason =
  | "identity_configuration_missing"
  | "user_id_missing"
  | "email_invalid_or_missing"
  | "verified_email_claim_missing_false_or_non_boolean"
  | "invitation_or_membership_not_found"
  | "invitation_lookup_error";

export type IdentityEnrollmentResult =
  | { allowed: true }
  | { allowed: false; reason: Exclude<SignInDenialReason, "identity_configuration_missing"> };

export function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLocaleLowerCase("en-US");
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

export async function evaluateInvitedIdentity({
  userId,
  email,
  emailVerified,
  repository,
  now = new Date(),
}: {
  userId: unknown;
  email: unknown;
  emailVerified: unknown;
  repository: InvitationEnrollmentRepository;
  now?: Date;
}): Promise<IdentityEnrollmentResult> {
  if (typeof userId !== "string" || !userId.trim()) {
    return { allowed: false, reason: "user_id_missing" };
  }

  const normalizedEmail = normalizeEmail(typeof email === "string" ? email : null);
  if (!normalizedEmail) {
    return { allowed: false, reason: "email_invalid_or_missing" };
  }

  if (emailVerified !== true) {
    return { allowed: false, reason: "verified_email_claim_missing_false_or_non_boolean" };
  }

  try {
    // Auth.js runs signIn before creating a first-time OAuth user. Only try to
    // accept an invitation here when its user row already exists; new users are
    // enrolled by the createUser event after the adapter persists that row.
    if (await repository.hasUser(userId)) {
      const accepted = await repository.acceptPendingInvitations(userId, normalizedEmail, now);
      if (accepted > 0) return { allowed: true };
      if (await repository.hasActiveMembership(userId)) return { allowed: true };
    } else if (await repository.hasEligibleInvitation(normalizedEmail, now)) {
      return { allowed: true };
    }
    return { allowed: false, reason: "invitation_or_membership_not_found" };
  } catch {
    return { allowed: false, reason: "invitation_lookup_error" };
  }
}
