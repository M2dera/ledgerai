import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { companyInvitations, companyMemberships } from "@/lib/db/schema";
import type { InvitationEnrollmentRepository } from "./enrollment";

export const invitationRepository: InvitationEnrollmentRepository = {
  async acceptPendingInvitations(userId, normalizedEmail, now) {
    return db.transaction(async (transaction) => {
      const pending = await transaction
        .select()
        .from(companyInvitations)
        .where(and(
          eq(companyInvitations.email, normalizedEmail),
          isNull(companyInvitations.acceptedAt),
          isNull(companyInvitations.revokedAt),
          gt(companyInvitations.expiresAt, now),
        ))
        .for("update");

      // Do not guess the active company if the email has multiple pending invitations.
      if (pending.length !== 1) return 0;
      const invitation = pending[0];

      await transaction.insert(companyMemberships).values({
        companyId: invitation.companyId,
        userId,
        role: invitation.role,
        active: true,
      }).onConflictDoNothing();
      await transaction.update(companyInvitations)
        .set({ acceptedAt: now })
        .where(eq(companyInvitations.id, invitation.id));
      return 1;
    });
  },

  async hasActiveMembership(userId) {
    const result = await db.select({ companyId: companyMemberships.companyId })
      .from(companyMemberships)
      .where(and(eq(companyMemberships.userId, userId), eq(companyMemberships.active, true)))
      .limit(1);
    return result.length > 0;
  },
};
