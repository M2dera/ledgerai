import { AnalystServiceError } from "@/lib/ai/errors";
import { createOllamaTransactionInterpreter } from "@/lib/ai/providers/ollama-transaction";
import { validateTransactionInterpretation } from "@/lib/accounting/transaction-understanding";

export const runtime = "nodejs";
const maxRequestBytes = 8_192;
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
    if (length > maxRequestBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxRequestBytes) return json({ error: { code: "invalid_request", message: "Request is invalid or too large." } }, 413);
  try {
    const raw = await readBoundedBody(request);
    if (raw === null) return json({ error: { code: "invalid_request", message: "Request is invalid or too large." } }, 413);
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
        typeof (body as { description?: unknown }).description !== "string" || !(body as { description: string }).description.trim() ||
        (body as { description: string }).description.length > 1000) {
      return json({ error: { code: "invalid_request", message: "Transaction description is invalid or too large." } }, 400);
    }
    const description = (body as { description: string }).description;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const cancel = () => controller.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    try {
      const candidate = await createOllamaTransactionInterpreter()(description, controller.signal);
      if (!validateTransactionInterpretation(candidate, description)) {
        return json({ candidate: null });
      }
      return json({ candidate });
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", cancel);
    }
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: { code: "invalid_request", message: "Request is invalid or too large." } }, 400);
    if (error instanceof AnalystServiceError) {
      return json({ error: { code: error.code, message: error.safeMessage } }, error.code === "timeout" ? 504 : 503);
    }
    return json({ error: { code: "provider_unavailable", message: "The local transaction interpreter is temporarily unavailable." } }, 503);
  }
}
