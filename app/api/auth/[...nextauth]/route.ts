import { handlers } from "@/auth";
import { isIdentityConfigured } from "@/lib/auth/config";

export const runtime = "nodejs";

function unavailable(): Response {
  return Response.json({ error: { code: "identity_not_configured", message: "Authentication is not configured. Set the server-side identity and database environment variables." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

export const GET: typeof handlers.GET = (request) => isIdentityConfigured() ? handlers.GET(request) : Promise.resolve(unavailable());
export const POST: typeof handlers.POST = (request) => isIdentityConfigured() ? handlers.POST(request) : Promise.resolve(unavailable());
