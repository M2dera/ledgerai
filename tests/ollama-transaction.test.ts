import { describe, expect, it } from "vitest";
import { AnalystServiceError } from "@/lib/ai/errors";
import { createOllamaTransactionInterpreter } from "@/lib/ai/providers/ollama-transaction";

const candidate = {
  intentType: "expense_payment", actionEvidence: "Settled office rent", categoryEvidence: "office rent",
  accountEvidence: "using cash", accountRole: "source",
};

function response(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ message: { role: "assistant", content }, done_reason: "stop" }), { status });
}

describe("Ollama transaction interpreter contract", () => {
  it("uses the configured local model and a constrained evidence-only schema", async () => {
    let url = "";
    let sent: Record<string, unknown> | undefined;
    const provider = createOllamaTransactionInterpreter({ baseUrl: "http://127.0.0.1:11434/", model: "qwen3:8b", fetcher: async (input, init) => {
      url = String(input);
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response(JSON.stringify(candidate));
    } });
    await expect(provider("Settled office rent using cash for 120 SAR")).resolves.toEqual(candidate);
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(sent).toMatchObject({ model: "qwen3:8b", stream: false, think: false });
    expect(sent?.format).toMatchObject({ type: "object", additionalProperties: false });
    expect(JSON.stringify(sent?.format)).not.toMatch(/amount|currency|accountId|debit|credit/i);
  });

  it("converts timeout, connection failure, and malformed provider output to safe errors", async () => {
    const timeout = createOllamaTransactionInterpreter({ timeoutMs: 5, fetcher: async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }) });
    await expect(timeout("Settled rent for 120 SAR")).rejects.toMatchObject({ code: "timeout" });

    const unavailable = createOllamaTransactionInterpreter({ fetcher: async () => { throw new Error("private host details"); } });
    await expect(unavailable("Settled rent for 120 SAR")).rejects.toMatchObject({ code: "provider_unavailable", safeMessage: expect.not.stringContaining("private host") });

    const malformed = createOllamaTransactionInterpreter({ fetcher: async () => response("not json") });
    await expect(malformed("Settled rent for 120 SAR")).rejects.toBeInstanceOf(AnalystServiceError);
  });
});
