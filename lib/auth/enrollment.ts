export type InvitationEnrollmentRepository = {
  acceptPendingInvitations: (userId: string, normalizedEmail: string, now: Date) => Promise<number>;
  hasActiveMembership: (userId: string) => Promise<boolean>;
};

export function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLocaleLowerCase("en-US");
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

export async function allowInvitedIdentity({
  userId,
  email,
  emailVerified,
  repository,
  now = new Date(),
}: {
  userId: string | null | undefined;
  email: string | null | undefined;
  emailVerified: boolean;
  repository: InvitationEnrollmentRepository;
  now?: Date;
}): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  if (!userId?.trim() || !normalizedEmail || !emailVerified) return false;

  const accepted = await repository.acceptPendingInvitations(userId, normalizedEmail, now);
  if (accepted > 0) return true;
  return repository.hasActiveMembership(userId);
}
