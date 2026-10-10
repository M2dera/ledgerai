export type CompanyPermissionErrorCode = "not_configured" | "unauthenticated" | "forbidden" | "company_context_unavailable";

export class CompanyPermissionError extends Error {
  constructor(readonly code: CompanyPermissionErrorCode) {
    super(code);
    this.name = "CompanyPermissionError";
  }
}

export function permissionErrorResponse(error: unknown): Response {
  if (!(error instanceof CompanyPermissionError)) {
    return Response.json({ error: { code: "identity_unavailable", message: "Identity service is temporarily unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const responses: Record<CompanyPermissionErrorCode, { status: number; message: string }> = {
    not_configured: { status: 503, message: "Authentication and company access are not configured." },
    unauthenticated: { status: 401, message: "Sign in is required." },
    forbidden: { status: 403, message: "An active company membership with this permission is required." },
    company_context_unavailable: { status: 403, message: "A single active company membership is required for this operation." },
  };
  const result = responses[error.code];
  return Response.json({ error: { code: error.code, message: result.message } }, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
