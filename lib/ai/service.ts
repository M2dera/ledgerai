import type { AnalystInterpretation, AnalystProvider, AnalystRequest } from "./types";
import { mockProvider } from "./providers/mock";
import { validateInterpretation } from "./validation";

export async function runAnalyst(request: AnalystRequest, provider: AnalystProvider = mockProvider, signal?: AbortSignal): Promise<AnalystInterpretation> {
  let result: AnalystInterpretation;
  try {
    result = await provider.interpret(request, signal);
  } catch {
    const code = signal?.aborted ? "timeout" : "provider_unavailable";
    throw Object.assign(new Error(code === "timeout" ? "Analyst request timed out." : "Analyst provider unavailable."), { code });
  }
  if (!validateInterpretation(result, request.context)) throw Object.assign(new Error("Analyst provider returned an invalid response."), { code: "invalid_response" });
  return result;
}
