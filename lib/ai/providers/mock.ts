import type { AnalystProvider, AnalystRequest, AnalystInterpretation } from "../types";

/** Deterministic local mock. It never contacts a model or echoes untrusted spreadsheet text. */
export const mockProvider: AnalystProvider = {
  name: "mock",
  async interpret(request: AnalystRequest, signal?: AbortSignal): Promise<AnalystInterpretation> {
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { code: "timeout" });
    const question = request.question.toLowerCase();
    const hasPeriodData = request.context.periods.length > 1;
    const summary = /compare|trend|period|month/.test(question) && !hasPeriodData
      ? "A period comparison is unavailable because the dataset does not contain enough valid dated periods."
      : "This local mock can organize a qualitative explanation from the verified context, but it does not perform AI reasoning. Use the verified facts panel for all financial figures.";
    return {
      provider: "mock", summary,
      investigateNext: ["Review the source transactions and classifications for the relevant period."],
      evidenceFactIds: request.context.facts.slice(0, 3).map((fact) => fact.id),
      uncertainty: request.context.quality.rowsSkipped ? ["Some rows were skipped during deterministic analysis."] : ["No real AI provider is connected; this is a deterministic mock response."],
    };
  },
};
