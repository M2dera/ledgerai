import { createEntryExplanationFacts, resolveEntryExplanation } from "@/lib/accounting/entry-explanation";
import type { JournalEntry, JournalEntryLine } from "@/lib/accounting/types";
import { createOllamaEntryExplanationInterpreter } from "@/lib/ai/providers/ollama-entry-explanation";
import { permissionErrorResponse } from "@/lib/auth/errors";
import { requireCompanyPermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";
const maxRequestBytes = 16_384;
const responseHeaders = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache", "Content-Type": "application/json" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: responseHeaders });
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEntry(value: unknown): JournalEntry | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "currency,date,description,id,lines" ||
      typeof value.id !== "string" || value.id.length > 160 || typeof value.date !== "string" || value.date.length > 40 ||
      typeof value.description !== "string" || value.description.length > 2000 || typeof value.currency !== "string" ||
      !Array.isArray(value.lines) || value.lines.length > 100) return undefined;
  const lines: JournalEntryLine[] = [];
  for (const valueLine of value.lines) {
    if (!isRecord(valueLine) || Object.keys(valueLine).sort().join(",") !== "accountId,credit,debit" ||
        typeof valueLine.accountId !== "string" || valueLine.accountId.length > 160 ||
        typeof valueLine.debit !== "number" || typeof valueLine.credit !== "number") return undefined;
    lines.push({ accountId: valueLine.accountId, debit: valueLine.debit, credit: valueLine.credit });
  }
  return { id: value.id, date: value.date, description: value.description, currency: value.currency, lines };
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireCompanyPermission("ai:use");
  } catch (error) {
    return permissionErrorResponse(error);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxRequestBytes) return json({ error: "Invalid or oversized entry." }, 413);
  try {
    const raw = await readBoundedBody(request);
    if (raw === null) return json({ error: "Invalid or oversized entry." }, 413);
    const body: unknown = JSON.parse(raw);
    if (!isRecord(body) || Object.keys(body).join(",") !== "entry") return json({ error: "Invalid entry." }, 400);
    const entry = readEntry(body.entry);
    const facts = entry ? createEntryExplanationFacts(entry) : undefined;
    if (!facts) return json({ error: "Only valid suggested journal entries can be explained." }, 400);

    const explanation = await resolveEntryExplanation(facts, createOllamaEntryExplanationInterpreter(), undefined, request.signal);
    return json({ explanation });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return json({ error: "Invalid entry." }, 400);
    return json({ error: "Unable to explain this entry." }, 400);
  }
}
