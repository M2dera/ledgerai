export type AuthEnvironment = {
  AUTH_SECRET?: string;
  DATABASE_URL?: string;
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
};

function currentEnvironment(): AuthEnvironment {
  return {
    AUTH_SECRET: process.env.AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    OIDC_ISSUER: process.env.OIDC_ISSUER,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
  };
}

export function isIdentityConfigured(env: AuthEnvironment = currentEnvironment()): boolean {
  return Boolean(
    env.AUTH_SECRET?.trim() &&
    env.DATABASE_URL?.trim() &&
    env.OIDC_ISSUER?.trim() &&
    env.OIDC_CLIENT_ID?.trim() &&
    env.OIDC_CLIENT_SECRET?.trim(),
  );
}

export function createOidcProvider(env: AuthEnvironment = currentEnvironment()) {
  const issuer = env.OIDC_ISSUER?.trim();
  const clientId = env.OIDC_CLIENT_ID?.trim();
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) return null;

  return {
    id: "oidc",
    name: "Organization sign-in",
    type: "oidc" as const,
    issuer,
    clientId,
    clientSecret,
  };
}
