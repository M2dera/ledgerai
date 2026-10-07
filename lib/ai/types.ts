import type { FinancialFactUnit, FinancialPeriod, FinancialQuality, FinancialUnit, PeriodComparison } from "@/lib/financial/types";

export type FinancialFact = { id: string; kind: "total" | "ratio" | "category" | "period" | "comparison"; label: string; labelTrust: "verified" | "untrusted"; value: number; unit: FinancialFactUnit; periodId?: string };
export type ContextCategory = {
  rank: number;
  label: { value: string; trust: "untrusted" };
  expenses: number;
  sharePercent: number | null;
  factId: string;
  shareFactId: string | null;
};
export type CategoryPeriodChange = {
  label: { value: string; trust: "untrusted" };
  earlierPeriod: string;
  laterPeriod: string;
  earlierExpenses: number;
  laterExpenses: number;
  delta: number;
  earlierFactId: string;
  laterFactId: string;
  deltaFactId: string;
};
export type FinancialTrend = {
  metric: "revenue" | "expenses" | "profit";
  direction: "increasing" | "decreasing" | "stable" | "mixed";
  periodIds: string[];
  factRefs: string[];
};
export type FinancialChangeSignal = {
  label: { value: string; trust: "verified" | "untrusted" };
  earlierPeriod: string;
  laterPeriod: string;
  delta: number;
  factId: string;
};
export type FinancialContext = {
  version: 3;
  facts: FinancialFact[];
  categories: ContextCategory[];
  periods: FinancialPeriod[];
  comparisons: PeriodComparison[];
  categoryChanges: CategoryPeriodChange[];
  trends: FinancialTrend[];
  largestChanges: { positive: FinancialChangeSignal | null; negative: FinancialChangeSignal | null };
  quality: { level: FinancialQuality; confidence: number; rowsAnalyzed: number; rowsSkipped: number; warnings: Array<{ value: string; trust: "untrusted" }> };
  unit: FinancialUnit;
  transactionDetails: Array<{ date?: string; description: { value: string; trust: "untrusted" }; amount: number }>;
};
export type AnalystRequest = { question: string; context: FinancialContext };
export type AnalystInterpretation = { provider: "mock" | "ollama"; interpretation: string; investigateNext: string[]; uncertainty: string[]; factRefs: string[] };
export type ProviderError = { code: "invalid_request" | "context_too_large" | "rate_limited" | "timeout" | "provider_unavailable" | "model_missing" | "empty_response" | "invalid_response"; safeMessage: string; retryable: boolean };
export type UsagePolicy = { maxRequestBytes: number; maxQuestionCharacters: number; maxFacts: number; maxCategories: number; maxPeriods: number; maxTransactions: number; timeoutMs: number };
export interface AnalystProvider { readonly name: string; interpret(request: AnalystRequest, signal?: AbortSignal): Promise<AnalystInterpretation> }
