import { auth, signIn, signOut } from "@/auth";
import { isIdentityConfigured } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (!isIdentityConfigured()) {
    return <main className="mx-auto max-w-xl p-8 text-white"><h1 className="text-2xl font-semibold">Sign-in is not configured</h1><p className="mt-3 text-zinc-300">Set the server-side database and OIDC environment variables described in the README.</p></main>;
  }

  let session;
  try {
    session = await auth();
  } catch {
    return <main className="mx-auto max-w-xl p-8 text-white"><h1 className="text-2xl font-semibold">Identity service unavailable</h1><p className="mt-3 text-zinc-300">Check the database connection and try again.</p></main>;
  }

  if (session?.user) {
    return (
      <main className="mx-auto max-w-xl p-8 text-white">
        <h1 className="text-2xl font-semibold">Signed in</h1>
        <p className="mt-3 text-zinc-300">Signed in as {session.user.email ?? session.user.name ?? "an invited user"}.</p>
        <p className="mt-2 text-sm text-amber-300">Accounting entries remain in this browser session and are not protected by server-side accounting permissions yet.</p>
        <form className="mt-6" action={async () => { "use server"; await signOut({ redirectTo: "/sign-in" }); }}>
          <button className="rounded-lg border border-zinc-600 px-4 py-2 hover:bg-zinc-900" type="submit">Sign out</button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-8 text-white">
      <h1 className="text-2xl font-semibold">Sign in to LedgerAI</h1>
      <p className="mt-3 text-zinc-300">Only users with a current invitation can join a company.</p>
      <form className="mt-6" action={async () => { "use server"; await signIn("oidc"); }}>
        <button className="rounded-lg bg-green-500 px-4 py-2 font-semibold text-black hover:bg-green-400" type="submit">Continue with your identity provider</button>
      </form>
    </main>
  );
}
