import { AnalystServiceError } from "../errors";
import { ANALYST_PROMPT_VERSION, ANALYST_SYSTEM_INSTRUCTIONS } from "../prompts";
import type { AnalystInterpretation, AnalystProvider, AnalystRequest, ProviderError } from "../types";
import { DEFAULT_USAGE_POLICY, validateInterpretation } from "../validation";

// Server-side only: this provider is wired through the analyst API route and must not enter a client import graph.

type OllamaOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

function fail(code: ProviderError["code"], safeMessage: string, retryable: boolean): AnalystServiceError {
  return new AnalystServiceError({ code, safeMessage, retryable });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseSchema(request: AnalystRequest): Record<string, unknown> {
  const factIdItems: Record<string, unknown> = request.context.facts.length
    ? { type: "string", enum: request.context.facts.map((fact) => fact.id) }
    : { type: "string", pattern: "^fact-[a-f0-9]{8}$" };
  return {
    type: "object",
    properties: {
      interpretation: { type: "string", maxLength: 1000 },
      investigateNext: { type: "array", maxItems: 5, items: { type: "string", maxLength: 300 } },
      uncertainty: { type: "array", maxItems: 5, items: { type: "string", maxLength: 300 } },
      factRefs: { type: "array", maxItems: 12, uniqueItems: true, items: factIdItems },
    },
    required: ["interpretation", "investigateNext", "uncertainty", "factRefs"],
    additionalProperties: false,
  };
}

function parseOllamaInterpretation(content: string, request: AnalystRequest): AnalystInterpretation {
  if (!content.trim()) throw fail("empty_response", "The local analyst returned an empty response. Please try again.", true);
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch { throw fail("invalid_response", "The local analyst returned a response LedgerAI could not safely read. Please retry your question.", true); }
  if (!isRecord(parsed) || typeof parsed.interpretation !== "string" || !Array.isArray(parsed.investigateNext) || !parsed.investigateNext.every((item) => typeof item === "string") || !Array.isArray(parsed.factRefs) || !parsed.factRefs.every((item) => typeof item === "string") || !Array.isArray(parsed.uncertainty) || !parsed.uncertainty.every((item) => typeof item === "string")) {
    throw fail("invalid_response", "The local analyst returned a response LedgerAI could not safely read.", true);
  }
  const interpretation: AnalystInterpretation = {
    provider: "ollama",
    interpretation: parsed.interpretation,
    investigateNext: parsed.investigateNext,
    factRefs: parsed.factRefs,
    uncertainty: parsed.uncertainty,
  };
  if (!validateInterpretation(interpretation, request.context)) {
    throw fail("invalid_response", "I could not verify the local analyst response safely. Please retry your question.", true);
  }
  return interpretation;
}

export function createOllamaProvider(options: OllamaOptions = {}): AnalystProvider {
  const baseUrl = (options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  const model = options.model ?? process.env.OLLAMA_MODEL ?? "qwen3:8b";
  const timeoutMs = options.timeoutMs ?? DEFAULT_USAGE_POLICY.timeoutMs;
  const fetcher = options.fetcher ?? fetch;

  return {
    name: "ollama",
    async interpret(request, signal): Promise<AnalystInterpretation> {
      let endpoint: URL;
      try {
        endpoint = new URL(`${baseUrl}/api/chat`);
        if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error("invalid URL");
      } catch {
        throw fail("provider_unavailable", "The local Ollama address is invalid. Check OLLAMA_BASE_URL.", false);
      }

      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, timeoutMs);
      try {
        const requestCompletion = async (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, maxTokens = 350): Promise<string> => {
          let response: Response;
          try {
            response = await fetcher(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              stream: false,
              format: responseSchema(request),
              think: false,
              options: { temperature: 0, num_predict: maxTokens },
              messages,
            }),
          });
          } catch {
            if (controller.signal.aborted) throw fail("timeout", "The local analyst took too long to respond. Please try again.", true);
            throw fail("provider_unavailable", "Ollama could not be reached. Check that it is running, then retry.", true);
          }

          if (!response.ok) {
            let payload: unknown;
            try { payload = await response.json(); } catch { payload = null; }
            const errorText = isRecord(payload) && typeof payload.error === "string" ? payload.error.toLowerCase() : "";
            if (errorText.includes("model") && errorText.includes("not found")) {
              throw fail("model_missing", `The Ollama model '${model}' is not available. Install it locally and try again.`, false);
            }
            throw fail("provider_unavailable", "Ollama is temporarily unavailable. Please wait a moment, then retry.", true);
          }

          let payload: unknown;
          try { payload = await response.json(); }
          catch { throw fail("invalid_response", "Ollama returned a response LedgerAI could not safely read. Please retry your question.", true); }

          if (!isRecord(payload) || !isRecord(payload.message) || typeof payload.message.content !== "string") {
            throw fail("invalid_response", "Ollama returned a response LedgerAI could not safely read.", true);
          }
          if (payload.done_reason === "length") throw fail("invalid_response", "Ollama's response was cut off. Please retry your question.", true);
          return payload.message.content;
        };

        const baseMessages = [
          { role: "system" as const, content: ANALYST_SYSTEM_INSTRUCTIONS },
          { role: "user" as const, content: JSON.stringify({ promptVersion: ANALYST_PROMPT_VERSION, question: request.question, financialContext: request.context }) },
        ];
        let retryUsed = false;
        const retryOnce = (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, maxTokens = 700) => {
          if (retryUsed) throw fail("invalid_response", "I could not verify the local analyst response safely. Please retry your question.", true);
          retryUsed = true;
          return requestCompletion(messages, maxTokens);
        };

        let firstContent: string;
        try {
          firstContent = await requestCompletion(baseMessages);
        } catch (error) {
          const recoverable = error instanceof AnalystServiceError && error.retryable && ["provider_unavailable", "invalid_response", "empty_response"].includes(error.code);
          if (!recoverable) throw error;
          firstContent = await retryOnce(baseMessages, error instanceof AnalystServiceError && error.code === "provider_unavailable" ? 350 : 700);
        }
        try {
          return parseOllamaInterpretation(firstContent, request);
        } catch (error) {
          const recoverable = error instanceof AnalystServiceError && ["invalid_response", "empty_response"].includes(error.code);
          if (!recoverable || retryUsed) throw error;
          const retryContent = await retryOnce([
            ...baseMessages,
            { role: "user", content: JSON.stringify({
              retryInstruction: "Rewrite the interpretation without any numerical or currency claims. Use factRefs instead.",
              retryInstructionArabic: "أعد صياغة الإجابة نوعيًا فقط. لا تكتب أرقامًا أو أعدادًا بالكلمات أو عملات أو مبالغ أو نسبًا مئوية في أي نص. ضع المراجع الموثقة في factRefs فقط.",
              requirements: ["Return the exact JSON fields interpretation, investigateNext, uncertainty, factRefs.", "Use only these known fact IDs in factRefs.", "Keep every prose field qualitative and free of digits, numbers written as words, amounts, currency names, and percentages."],
              knownFactIds: request.context.facts.map((fact) => fact.id),
            }) },
          ]);
          return parseOllamaInterpretation(retryContent, request);
        }
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
      }
    },
  };
}

export const ollamaProvider = createOllamaProvider();
