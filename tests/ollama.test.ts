import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { analyzeData } from "@/lib/analysis/analyzer";
import { createFinancialContext } from "@/lib/ai/context";
import { AnalystServiceError } from "@/lib/ai/errors";
import { createOllamaProvider } from "@/lib/ai/providers/ollama";
import type { AnalystRequest } from "@/lib/ai/types";
import { readExcel } from "@/lib/excel/reader";
import { createUploadedFile } from "@/lib/analysis/analyzer";
import { validateAnalystRequest } from "@/lib/ai/validation";

const dataset = analyzeData({
  columns: ["Revenue", "Expenses"],
  rows: [{ Revenue: 100, Expenses: 25 }],
  warnings: [],
  errors: [],
}, { id: "fixture", name: "fixture.csv", size: 1, type: "text/csv", uploadedAt: "2025-01-01T00:00:00.000Z" });
const request: AnalystRequest = { question: "What should I investigate?", context: createFinancialContext(dataset) };
const recommendationRequest: AnalystRequest = { question: "شنو تنصحني أراجع أول؟", context: request.context };
const validModelResponse = {
  interpretation: "The uncategorized expense group should be reviewed against its source mapping.",
  investigateNext: ["Review the largest expense categories against the source classifications."],
  factRefs: request.context.categories[0] ? [request.context.categories[0].factId] : [],
  uncertainty: ["The context does not include transaction-level explanations."],
};

function response(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ message: { role: "assistant", content }, done_reason: "stop" }), { status, headers: { "Content-Type": "application/json" } });
}

async function reportedDatasetRequest(question: string): Promise<AnalystRequest> {
  // Reconstruct the supplied test workbook's reported aggregate values via the production XLSX
  // reader and analyzer. This keeps the context shape and fact IDs on the real ingestion path.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Date", "Currency", "Category", "Revenue", "Expenses"],
    ["2025-01-03", "KWD", "Sales", 95000, 0],
    ["2025-01-04", "KWD", "Payroll", 0, 16550],
    ["2025-01-05", "KWD", "Rent", 0, 7000],
    ["2025-01-06", "KWD", "Other", 0, 4320],
  ]), "Transactions");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const file = new File([new Uint8Array(bytes)], "LedgerAI_test_financial_data.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const dataset = analyzeData(await readExcel(file), createUploadedFile(file));
  const context = createFinancialContext(dataset);
  return { question, context };
}

describe("local Ollama provider", () => {
  it("sends compact context to the native chat endpoint and validates the response", async () => {
    let sentUrl = "";
    let sentBody: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      sentUrl = String(input);
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response(JSON.stringify(validModelResponse));
    };
    const provider = createOllamaProvider({ baseUrl: "http://127.0.0.1:11434/", model: "qwen3:8b", fetcher });
    const result = await provider.interpret(request);
    expect(result).toMatchObject({ provider: "ollama", factRefs: validModelResponse.factRefs });
    expect(sentUrl).toBe("http://127.0.0.1:11434/api/chat");
    expect(sentBody).toMatchObject({ model: "qwen3:8b", stream: false, think: false });
    expect(sentBody?.format).toMatchObject({ type: "object", additionalProperties: false });
    expect(JSON.stringify(sentBody)).not.toContain('"raw"');
  });

  it("returns a safe timeout error", async () => {
    const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    const provider = createOllamaProvider({ timeoutMs: 5, fetcher });
    await expect(provider.interpret(request)).rejects.toMatchObject({ code: "timeout", safeMessage: expect.stringContaining("took too long") });
  });

  it("maps connection failures and missing models to safe errors", async () => {
    const disconnected = createOllamaProvider({ fetcher: async () => { throw new Error("private network details"); } });
    await expect(disconnected.interpret(request)).rejects.toMatchObject({ code: "provider_unavailable", safeMessage: expect.stringContaining("Ollama could not be reached") });

    const missingModel = createOllamaProvider({ fetcher: async () => new Response(JSON.stringify({ error: "model 'qwen3:8b' not found" }), { status: 404 }) });
    await expect(missingModel.interpret(request)).rejects.toMatchObject({ code: "model_missing", safeMessage: expect.stringContaining("qwen3:8b") });
  });

  it("rejects malformed, empty, and unknown-fact model responses", async () => {
    const malformed = createOllamaProvider({ fetcher: async () => response("not-json") });
    await expect(malformed.interpret(request)).rejects.toMatchObject({ code: "invalid_response" });

    const empty = createOllamaProvider({ fetcher: async () => response("  ") });
    await expect(empty.interpret(request)).rejects.toMatchObject({ code: "empty_response" });

    const unknownFact = createOllamaProvider({ fetcher: async () => response(JSON.stringify({ ...validModelResponse, factRefs: ["fact-deadbeef"] })) });
    await expect(unknownFact.interpret(request)).rejects.toBeInstanceOf(AnalystServiceError);
    await expect(unknownFact.interpret(request)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("retries once when financial digits or currency claims are rejected", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return response(JSON.stringify(calls === 1
        ? { ...validModelResponse, interpretation: "Revenue increased by 10 KWD." }
        : validModelResponse));
    };
    const provider = createOllamaProvider({ fetcher });
    const result = await provider.interpret(recommendationRequest);
    expect(result.interpretation).toBe(validModelResponse.interpretation);
    expect(calls).toBe(2);
  });

  it("accepts a qualitative response to the Arabic recommendation question", async () => {
    let sentBody: Record<string, unknown> | undefined;
    const provider = createOllamaProvider({ fetcher: async (_input, init) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response(JSON.stringify(validModelResponse));
    } });
    const result = await provider.interpret(recommendationRequest);
    expect(result).toMatchObject({ provider: "ollama", factRefs: validModelResponse.factRefs });
    expect(JSON.stringify(sentBody)).toContain(recommendationRequest.question);
    const factRefsSchema = (sentBody?.format as { properties?: { factRefs?: { contains?: { enum?: string[] } } } } | undefined)?.properties?.factRefs;
    expect(factRefsSchema?.contains?.enum).toEqual(recommendationRequest.context.categories.slice(0, 3).map((category) => category.factId));
  });

  it("retries a temporary Ollama 503 once and then succeeds", async () => {
    let calls = 0;
    const provider = createOllamaProvider({ fetcher: async () => {
      calls += 1;
      return calls === 1
        ? new Response("temporarily overloaded", { status: 503, headers: { "Content-Type": "text/plain" } })
        : response(JSON.stringify(validModelResponse));
    } });
    const result = await provider.interpret(recommendationRequest);
    expect(result.provider).toBe("ollama");
    expect(calls).toBe(2);
  });

  it("returns a clear retryable error when Ollama remains unavailable", async () => {
    let calls = 0;
    const provider = createOllamaProvider({ fetcher: async () => {
      calls += 1;
      return new Response("private provider detail", { status: 503, headers: { "Content-Type": "text/plain" } });
    } });
    await expect(provider.interpret(recommendationRequest)).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
      safeMessage: expect.stringContaining("wait a moment, then retry"),
    });
    expect(calls).toBe(2);
  });

  it("rejects unsupported numeric and currency prose after only one retry", async () => {
    for (const claim of ["Costs rose by 10.", "Costs rose in KWD.", "The percentage increased.", "Costs rose in د.ك."]) {
      let calls = 0;
      const provider = createOllamaProvider({ fetcher: async () => {
        calls += 1;
        return response(JSON.stringify({ ...validModelResponse, interpretation: claim }));
      } });
      await expect(provider.interpret(request)).rejects.toMatchObject({ code: "invalid_response" });
      expect(calls).toBe(2);
    }
  });

  it("rejects unsupported domain concepts after the bounded retry without fabricating a fallback", async () => {
    let calls = 0;
    const provider = createOllamaProvider({ fetcher: async () => {
      calls += 1;
      return response(JSON.stringify({ ...validModelResponse, interpretation: "Transfers explain the expense pattern." }));
    } });
    await expect(provider.interpret(recommendationRequest)).rejects.toMatchObject({ code: "invalid_response" });
    expect(calls).toBe(2);
  });

  it("returns a safe retryable error after the single response repair is rejected", async () => {
    let calls = 0;
    const provider = createOllamaProvider({ fetcher: async () => {
      calls += 1;
      return response(JSON.stringify({ ...validModelResponse, interpretation: "Expenses increased by 12 KWD." }));
    } });
    await expect(provider.interpret(recommendationRequest)).rejects.toMatchObject({
      code: "invalid_response",
      retryable: true,
      safeMessage: expect.stringContaining("Please retry your question"),
    });
    expect(calls).toBe(2);
  });

  it("includes one rewrite instruction and rejects unknown fact references", async () => {
    let calls = 0;
    let retryBody: Record<string, unknown> | undefined;
    const provider = createOllamaProvider({ fetcher: async (_input, init) => {
      calls += 1;
      if (calls === 2) retryBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response(JSON.stringify({ ...validModelResponse, factRefs: ["fact-deadbeef"] }));
    } });
    await expect(provider.interpret(request)).rejects.toMatchObject({ code: "invalid_response" });
    expect(calls).toBe(2);
    expect(JSON.stringify(retryBody)).toContain("strict fact and length checks");
    expect(JSON.stringify(retryBody)).toContain("relevantExpenseCategoryFactIds");
    expect(JSON.stringify(retryBody)).toContain("knownFactIds");
  });

  it("uses production-shaped workbook facts and identical allowed fact IDs for schema, retry, and validation", async () => {
    const realShapeRequest = await reportedDatasetRequest("What should I investigate?");
    const { context } = realShapeRequest;
    expect(validateAnalystRequest(realShapeRequest)).toBe(true);
    expect(context.unit).toMatchObject({ status: "known", code: "KWD" });
    expect(context.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "total", label: "revenue", value: 95000 }),
      expect.objectContaining({ kind: "total", label: "expenses", value: 27870 }),
      expect.objectContaining({ kind: "total", label: "profit", value: 67130 }),
      expect.objectContaining({ kind: "category", label: "Payroll", value: 16550 }),
      expect.objectContaining({ kind: "ratio", label: "expense ratio percent", value: 29.336842105263156 }),
      expect.objectContaining({ kind: "ratio", label: "profit margin percent", value: 70.66315789473684 }),
    ]));

    let calls = 0;
    let firstSchemaIds: string[] = [];
    let retryPayload: Record<string, unknown> | undefined;
    const provider = createOllamaProvider({ fetcher: async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { format?: { properties?: { factRefs?: { items?: { enum?: string[] } } } }; messages?: Array<{ content: string }> };
      if (calls === 1) firstSchemaIds = body.format?.properties?.factRefs?.items?.enum ?? [];
      if (calls === 1) return response("{ malformed");
      retryPayload = JSON.parse(body.messages?.[2]?.content ?? "{}") as Record<string, unknown>;
      return response(JSON.stringify({
        ...validModelResponse,
        interpretation: "Payroll is the leading expense category and should be reviewed using verified evidence.",
        investigateNext: ["Review the Payroll category classification."],
        factRefs: [context.facts.find((fact) => fact.label === "Payroll")!.id],
      }));
    } });

    const result = await provider.interpret(realShapeRequest);
    const knownFactIds = retryPayload?.knownFactIds;
    const expectedAllowedIds = context.categories.slice(0, 3).map((category) => category.factId);
    expect(firstSchemaIds).toEqual(expectedAllowedIds);
    expect(knownFactIds).toEqual(firstSchemaIds);
    expect(result.factRefs).toEqual([context.facts.find((fact) => fact.label === "Payroll")!.id]);
    expect(context.facts.some((fact) => fact.id === result.factRefs[0])).toBe(true);
    expect(calls).toBe(2);
  });

  it("retries a truncated Ollama response once with more output room", async () => {
    let calls = 0;
    const predictLimits: number[] = [];
    const provider = createOllamaProvider({ fetcher: async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { options?: { num_predict?: number } };
      predictLimits.push(body.options?.num_predict ?? 0);
      if (calls === 1) return new Response(JSON.stringify({ message: { role: "assistant", content: "{" }, done_reason: "length" }), { status: 200 });
      return response(JSON.stringify(validModelResponse));
    } });
    await expect(provider.interpret(recommendationRequest)).resolves.toMatchObject({ provider: "ollama" });
    expect(calls).toBe(2);
    expect(predictLimits).toEqual([800, 800]);
  });
});
