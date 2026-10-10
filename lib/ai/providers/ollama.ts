import { AnalystServiceError } from "../errors";
import { ANALYST_PROMPT_VERSION, ANALYST_SYSTEM_INSTRUCTIONS } from "../prompts";
import type { AnalystInterpretation, AnalystProvider, AnalystRequest, ProviderError } from "../types";
import { completeCategoryFactRefs, DEFAULT_USAGE_POLICY, getInterpretationValidationIssues } from "../validation";

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

function responseFactIds(request: AnalystRequest): string[] {
  const question = request.question;
  const isRecommendation = /\b(?:recommend\w*|suggest\w*|review|investigat\w*)\b|\u062A\u0646\u0635\u062D|\u0627\u0631\u0627\u062C\u0639|\u0646\u0631\u0627\u062C\u0639|\u0627\u0641\u062D\u0635/u.test(question);
  const asksProfitChange = /\bprofit\b|\u0631\u0628\u062D|\u0627\u0644\u0631\u0628\u062D/u.test(question) && /\b(?:change|changed|why|trend|decreas|increase|fall|drop)\b|\u062A\u063A\u064A\u0631|\u0646\u0627\u0632\u0644|\u0645\u0631\u062A\u0641\u0639|\u0644\u064A\u0634/u.test(question);
  const asksExpenseDrivers = /\b(?:expense|spending|cost|problem|issue|attention|review|recommend\w*|investigat\w*)\b|\u0645\u0635\u0631\u0648\u0641|\u0645\u0635\u0627\u0631\u064A\u0641|\u0646\u0641\u0642\u0627\u062A|\u0648\u064A\u0646|\u0645\u0634\u0643\u0644|\u0627\u0646\u062A\u0628\u0627\u0647|\u062A\u0646\u0635\u062D|\u0627\u0631\u0627\u062C\u0639/u.test(question);
  if (asksProfitChange) {
    const profitFact = request.context.facts.find((fact) => fact.kind === "comparison" && /profit delta/i.test(fact.label));
    const pair = profitFact?.label.replace(/\s+profit delta$/i, "");
    if (pair) return ["revenue", "expenses", "profit"].flatMap((metric) => {
      const fact = request.context.facts.find((candidate) => candidate.kind === "comparison" && candidate.label === `${pair} ${metric} delta`);
      return fact ? [fact.id] : [];
    });
  }
  if (asksExpenseDrivers) return [
      ...request.context.categories.slice(0, 3).map((category) => category.factId),
      ...(!isRecommendation ? request.context.facts.filter((fact) => fact.kind === "comparison" && /(?:revenue|expenses|profit) delta$/i.test(fact.label)).map((fact) => fact.id) : []),
    ];
  return request.context.facts.map((fact) => fact.id);
}

function analysisGuidance(request: AnalystRequest): string | undefined {
  const allowed = new Set(responseFactIds(request));
  if (request.context.categories.length && request.context.categories.slice(0, 4).every((category) => allowed.has(category.factId)) && !request.context.facts.some((fact) => fact.kind === "comparison" && allowed.has(fact.id))) {
    return "Reply in the question's language. Focus only on the highest-ranked supplied expense categories. Use category names exactly as supplied. Recommend reviewing a named category or its source mapping; do not mention totals, causes, or trends.";
  }
  if (request.context.categories.length && request.context.facts.some((fact) => fact.kind === "comparison" && allowed.has(fact.id))) {
    const requiredCategoryIds = request.context.categories.slice(0, 3).map((category) => category.factId);
    return `Reply in the question's language. Name one or two supplied expense categories exactly as supplied and cite their category fact IDs. At least one factRefs item MUST be one of these ranked category IDs: ${JSON.stringify(requiredCategoryIds)}. If describing a metric trend, cite that metric's supplied comparison fact. Do not state causes that the data does not establish.`;
  }
  if (allowed.size === 3 && [...allowed].every((id) => request.context.facts.find((fact) => fact.id === id)?.kind === "comparison")) {
    return "Explain only the qualitative relationship among the supplied same-period revenue, expense, and profit changes. Do not infer an unsupported cause.";
  }
  return undefined;
}

class RejectedModelOutput extends Error {
  constructor(readonly issues: string[]) { super("Model output rejected by LedgerAI validation."); }
}

function responseSchema(request: AnalystRequest): Record<string, unknown> {
  const allowedFactIds = responseFactIds(request);
  const factIdItems: Record<string, unknown> = request.context.facts.length
    ? { type: "string", enum: allowedFactIds }
    : { type: "string", pattern: "^fact-[a-f0-9]{8}$" };
  const requiresExpenseCategory = /\b(?:expense|spending|cost|problem|issue|attention|review|recommend|investigat)\b|\u0645\u0635\u0631\u0648\u0641|\u0645\u0635\u0627\u0631\u064A\u0641|\u0646\u0641\u0642\u0627\u062A|\u0648\u064A\u0646|\u0645\u0634\u0643\u0644|\u0627\u0646\u062A\u0628\u0627\u0647|\u062A\u0646\u0635\u062D|\u0627\u0631\u0627\u062C\u0639/u.test(request.question);
  const factRefsSchema: Record<string, unknown> = { type: "array", maxItems: 6, uniqueItems: true, items: factIdItems };
  if (requiresExpenseCategory) factRefsSchema.contains = { type: "string", enum: request.context.categories.slice(0, 3).map((category) => category.factId) };
  return {
    type: "object",
    properties: {
      interpretation: { type: "string", maxLength: 220 },
      investigateNext: { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } },
      uncertainty: { type: "array", maxItems: 2, items: { type: "string", maxLength: 180 } },
      factRefs: factRefsSchema,
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
  const allowedFactIds = new Set(responseFactIds(request));
  const groundedParsed = completeCategoryFactRefs(parsed, request.context, allowedFactIds) as Pick<AnalystInterpretation, "interpretation" | "investigateNext" | "uncertainty" | "factRefs">;
  if (groundedParsed.factRefs.some((id) => !allowedFactIds.has(id))) throw new RejectedModelOutput(["irrelevant_fact_reference"]);
  const interpretation: AnalystInterpretation = {
    provider: "ollama",
    interpretation: groundedParsed.interpretation,
    investigateNext: groundedParsed.investigateNext,
    factRefs: groundedParsed.factRefs,
    uncertainty: groundedParsed.uncertainty,
  };
  const issues = getInterpretationValidationIssues(interpretation, request.context, request.question);
  if (issues.length > 0) {
    throw new RejectedModelOutput(issues);
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
        const requestCompletion = async (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, maxTokens = 800): Promise<string> => {
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
          { role: "user" as const, content: JSON.stringify({ promptVersion: ANALYST_PROMPT_VERSION, question: request.question, analysisGuidance: analysisGuidance(request), financialContext: request.context }) },
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
          const retryMessages = error instanceof AnalystServiceError && error.code === "invalid_response"
            ? [...baseMessages, { role: "user" as const, content: "The previous response was cut off or malformed. Return a concise complete JSON object that follows the required field and length limits. Use only relevant supplied fact IDs." }]
            : baseMessages;
          firstContent = await retryOnce(retryMessages, 800);
        }
        try {
          return parseOllamaInterpretation(firstContent, request);
        } catch (error) {
          const recoverable = (error instanceof AnalystServiceError && ["invalid_response", "empty_response"].includes(error.code)) || error instanceof RejectedModelOutput;
          if (!recoverable || retryUsed) {
            if (error instanceof AnalystServiceError) throw error;
            throw fail("invalid_response", "I could not verify the local analyst response safely. Please retry your question.", true);
          }
          const rejectionIssues = error instanceof RejectedModelOutput ? error.issues : ["malformed_or_empty_response"];
          const repairNotes = [
            ...(rejectionIssues.some((issue) => issue === "unsupported_quantitative_claim") ? ["Keep all prose free of numbers, dates, money, percentages, and quantitative wording."] : []),
            ...(rejectionIssues.some((issue) => issue.startsWith("unsupported_concept:")) ? ["Remove every business area, event, or cause that is not represented by the supplied categories, metrics, and periods."] : []),
            ...(rejectionIssues.includes("irrelevant_fact_reference") ? ["For an expense investigation, name one or two supplied expense categories exactly as written and cite each category fact ID. Cite the expense-change fact only if you describe its direction. Do not cite unrelated facts."] : []),
            ...(rejectionIssues.includes("missing_profit_driver_comparisons") ? ["For the profit-change question, cite revenue, expense, and profit comparisons from the same period pair."] : []),
            ...(rejectionIssues.some((issue) => issue === "malformed_prose" || issue === "malformed_response") ? ["Keep the required fields within their exact length and item limits."] : []),
          ];
          const categoryDriverFactIds = request.context.categories.slice(0, 4).flatMap((category) => [category.factId, ...(category.shareFactId ? [category.shareFactId] : [])]);
          const profitComparisonFactIds = request.context.facts.filter((fact) => fact.kind === "comparison" && /profit|Ø±Ø¨Ø­/iu.test(fact.label)).map((fact) => fact.id);
          const profitDriverComparisonFactIds = request.context.facts.filter((fact) => fact.kind === "comparison" && /(?:revenue|expenses|profit) delta/i.test(fact.label)).map((fact) => fact.id);
          const retryContent = await retryOnce([
            ...baseMessages,
            { role: "user", content: JSON.stringify({
              retryInstruction: "Rewrite a concise qualitative interpretation that passes LedgerAI's strict fact and length checks. Never include any numerical or currency claims.",
              retryInstructionArabic: "أعد صياغة الإجابة نوعيًا فقط. لا تكتب أرقامًا أو أعدادًا بالكلمات أو عملات أو مبالغ أو نسبًا مئوية في أي نص. ضع المراجع الموثقة في factRefs فقط.",
              repairNotes,
              relevantExpenseCategoryFactIds: categoryDriverFactIds,
              relevantProfitComparisonFactIds: profitComparisonFactIds,
              relevantProfitChangeFactIds: profitDriverComparisonFactIds,
              requirements: ["Return the exact JSON fields interpretation, investigateNext, uncertainty, factRefs.", "Keep interpretation to one sentence no longer than 220 characters; use at most three investigateNext items and two uncertainty items, each no longer than 180 characters.", "Use no more than six factRefs and choose only IDs directly relevant to the stated qualitative claims; reference the category facts when discussing expense drivers, and revenue, expense, and profit comparison facts from the same period pair when explaining profit changes.", "Do not include unrelated total or ratio references. Discuss only categories, periods, trends, and concepts included in the supplied financial context.", "Keep every prose field qualitative and free of digits, numbers written as words, amounts, currency names, and percentages."],
              knownFactIds: responseFactIds(request),
            }) },
          ]);
          try { return parseOllamaInterpretation(retryContent, request); }
          catch (retryError) {
            if (retryError instanceof AnalystServiceError) throw retryError;
            throw fail("invalid_response", "I could not verify the local analyst response safely. Please retry your question.", true);
          }
        }
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
      }
    },
  };
}

export const ollamaProvider = createOllamaProvider();
