import type { FinancialFactUnit, FinancialPeriod, FinancialQuality, FinancialUnit, PeriodComparison } from "@/lib/financial/types";

export type FinancialFact = { id: string; kind: "total" | "ratio" | "category" | "period" | "comparison"; label: string; value: number; unit: FinancialFactUnit; periodId?: string };
export type FinancialContext = {
  version: 2;
  facts: FinancialFact[];
  categories: Array<{ label: { value: string; trust: "untrusted" }; expenses: number }>;
  periods: FinancialPeriod[];
  comparisons: PeriodComparison[];
  quality: { level: FinancialQuality; confidence: number; rowsAnalyzed: number; rowsSkipped: number; warnings: Array<{ value: string; trust: "untrusted" }> };
  unit: FinancialUnit;
  transactionDetails: Array<{ date?: string; description: { value: string; trust: "untrusted" }; amount: number }>;
};
export type AnalystRequest = { question: string; context: FinancialContext };
export type AnalystInterpretation = { provider: "mock" | "ollama"; interpretation: string; investigateNext: string[]; uncertainty: string[]; factRefs: string[] };
export type ProviderError = { code: "invalid_request" | "context_too_large" | "rate_limited" | "timeout" | "provider_unavailable" | "model_missing" | "empty_response" | "invalid_response"; safeMessage: string; retryable: boolean };
export type UsagePolicy = { maxRequestBytes: number; maxQuestionCharacters: number; maxFacts: number; maxCategories: number; maxPeriods: number; maxTransactions: number; timeoutMs: number };
export interface AnalystProvider { readonly name: string; interpret(request: AnalystRequest, signal?: AbortSignal): Promise<AnalystInterpretation> }
