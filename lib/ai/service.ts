import { AnalystServiceError } from "./errors";
import { ollamaProvider } from "./providers/ollama";
import type { AnalystInterpretation, AnalystProvider, AnalystRequest } from "./types";
import { validateInterpretation } from "./validation";

// Keep provider selection inside the server API path; do not import this module from client components.
export async function runAnalyst(request: AnalystRequest, provider: AnalystProvider = ollamaProvider, signal?: AbortSignal): Promise<AnalystInterpretation> {
  let result: AnalystInterpretation;
  try {
    result = await provider.interpret(request, signal);
  } catch (error) {
    if (error instanceof AnalystServiceError) throw error;
    if (signal?.aborted) throw new AnalystServiceError({ code: "timeout", safeMessage: "The local analyst took too long to respond. Please try again.", retryable: true });
    throw new AnalystServiceError({ code: "provider_unavailable", safeMessage: "The local analyst is temporarily unavailable. Make sure Ollama is running, then retry.", retryable: true });
  }
  if (!validateInterpretation(result, request.context, request.question)) {
    throw new AnalystServiceError({ code: "invalid_response", safeMessage: "The local analyst returned a response LedgerAI could not safely verify.", retryable: true });
  }
  return result;
}
