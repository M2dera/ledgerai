import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { allowInvitedIdentity } from "@/lib/auth/enrollment";
import { createOidcProvider, isIdentityConfigured } from "@/lib/auth/config";
import { invitationRepository } from "@/lib/auth/invitation-repository";

const oidcProvider = createOidcProvider();
const drizzleAdapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});
const adapter = {
  ...drizzleAdapter,
  async linkAccount(account: Parameters<NonNullable<typeof drizzleAdapter.linkAccount>>[0]) {
    // LedgerAI does not call the identity provider's APIs after authentication.
    // Avoid retaining bearer and refresh tokens we do not need.
    await drizzleAdapter.linkAccount?.({
      ...account,
      access_token: undefined,
      refresh_token: undefined,
      id_token: undefined,
    });
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers: oidcProvider ? [oidcProvider] : [],
  session: { strategy: "database" },
  secret: process.env.AUTH_SECRET,
  trustHost: process.env.AUTH_TRUST_HOST === "true",
  pages: { signIn: "/sign-in" },
  callbacks: {
    async signIn({ user, profile }) {
      if (!isIdentityConfigured()) return false;
      const emailVerified = typeof profile === "object" && profile !== null && "email_verified" in profile && profile.email_verified === true;
      try {
        return await allowInvitedIdentity({
          userId: user.id,
          email: user.email,
          emailVerified,
          repository: invitationRepository,
        });
      } catch {
        return false;
      }
    },
    async session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
});
