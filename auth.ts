import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { createOidcProvider, isIdentityConfigured } from "@/lib/auth/config";
import { invitationRepository } from "@/lib/auth/invitation-repository";
import { createIdentitySignInCallback, createIdentityUserCreatedHandler } from "@/lib/auth/sign-in-callback";

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

const signInCallback = createIdentitySignInCallback({
  isConfigured: isIdentityConfigured,
  repository: invitationRepository,
});
const userCreatedHandler = createIdentityUserCreatedHandler({ repository: invitationRepository });

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers: oidcProvider ? [oidcProvider] : [],
  session: { strategy: "database" },
  secret: process.env.AUTH_SECRET,
  trustHost: process.env.AUTH_TRUST_HOST === "true",
  pages: { signIn: "/sign-in" },
  callbacks: {
    signIn: signInCallback,
    async session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
  events: {
    createUser: userCreatedHandler,
  },
});
