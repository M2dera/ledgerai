import { runAnalyst } from "@/lib/ai/service";
import { AnalystServiceError } from "@/lib/ai/errors";
import { DEFAULT_USAGE_POLICY, validateAnalystRequest } from "@/lib/ai/validation";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache", "Content-Type": "application/json" };
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers }); }

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > DEFAULT_USAGE_POLICY.maxRequestBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > DEFAULT_USAGE_POLICY.maxRequestBytes) return json({ error: { code: "invalid_request", message: "Request is invalid or too large." } }, 413);
  try {
    const body = await readBoundedBody(request);
    if (body === null) return json({ error: { code: "invalid_request", message: "Request is invalid or too large." } }, 413);
    const parsed: unknown = JSON.parse(body);
    if (!validateAnalystRequest(parsed)) return json({ error: { code: "invalid_request", message: "Request is invalid or too large." } }, 400);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_USAGE_POLICY.timeoutMs);
    const cancel = () => controller.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    const timeoutResult = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { code: "timeout" })), { once: true }));
    try { return json({ interpretation: await Promise.race([runAnalyst(parsed, undefined, controller.signal), timeoutResult]) }); }
    finally { clearTimeout(timeout); request.signal.removeEventListener("abort", cancel); }
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: { code: "invalid_request", message: "Request is invalid or too large." } }, 400);
    // Do not log request bodies, user content, or provider exceptions.
    if (error instanceof AnalystServiceError) {
      const status = error.code === "timeout" ? 504 : error.code === "invalid_request" ? 400 : 503;
      return json({ error: { code: error.code, message: error.safeMessage } }, status);
    }
    if (error instanceof Error && "code" in error && error.code === "timeout") {
      return json({ error: { code: "timeout", message: "The local analyst took too long to respond. Please try again." } }, 504);
    }
    return json({ error: { code: "provider_unavailable", message: "The local analyst service is temporarily unavailable." } }, 503);
  }
}
