import type { AnalystInterpretation, AnalystRequest, FinancialContext } from "./types";

export const DEFAULT_USAGE_POLICY = { maxRequestBytes: 20_000, maxQuestionCharacters: 1_000, maxFacts: 64, maxCategories: 8, maxPeriods: 12, maxTransactions: 3, timeoutMs: 60_000 } as const;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validUnit = (value: unknown): boolean => record(value) && ["known", "unknown", "ambiguous"].includes(String(value.status)) && ["header", "cell", "unknown"].includes(String(value.source)) && (value.code === null || typeof value.code === "string") && Array.isArray(value.candidates) && value.candidates.length <= 8 && value.candidates.every((candidate) => typeof candidate === "string" && candidate.length <= 12) && (value.status !== "known" || typeof value.code === "string") && (value.status !== "ambiguous" || value.code === null);
const validFactUnit = (value: unknown): boolean => record(value) && (value.kind === "percentage" || (value.kind === "currency" && validUnit(value.unit)));

export function validateAnalystRequest(value: unknown): value is AnalystRequest {
  if (!record(value) || typeof value.question !== "string" || !value.question.trim() || value.question.length > DEFAULT_USAGE_POLICY.maxQuestionCharacters || !record(value.context)) return false;
  const c = value.context as unknown as FinancialContext;
  if (c.version !== 2 || !Array.isArray(c.facts) || c.facts.length > DEFAULT_USAGE_POLICY.maxFacts || !Array.isArray(c.categories) || c.categories.length > DEFAULT_USAGE_POLICY.maxCategories || !Array.isArray(c.periods) || c.periods.length > DEFAULT_USAGE_POLICY.maxPeriods || !Array.isArray(c.comparisons) || c.comparisons.length > 12 || !Array.isArray(c.transactionDetails) || c.transactionDetails.length > DEFAULT_USAGE_POLICY.maxTransactions || !record(c.quality) || !record(c.unit)) return false;
  if (!c.facts.every((fact) => record(fact) && typeof fact.id === "string" && /^fact-[a-f0-9]{8}$/.test(fact.id) && typeof fact.label === "string" && fact.label.length <= 160 && ["total", "ratio", "category", "period", "comparison"].includes(String(fact.kind)) && finite(fact.value) && validFactUnit(fact.unit) && (fact.kind !== "ratio" || (record(fact.unit) && fact.unit.kind === "percentage")) && (fact.kind === "ratio" || (record(fact.unit) && fact.unit.kind === "currency")))) return false;
  if (new Set(c.facts.map((fact) => fact.id)).size !== c.facts.length) return false;
  if (!c.categories.every((item) => record(item) && record(item.label) && item.label.trust === "untrusted" && typeof item.label.value === "string" && item.label.value.length <= 100 && finite(item.expenses) && item.expenses >= 0)) return false;
  if (!c.periods.every((item) => record(item) && typeof item.id === "string" && item.id.length <= 12 && finite(item.rowsAnalyzed) && finite(item.year) && finite(item.month) && item.month >= 1 && item.month <= 12 && [item.revenue, item.expenses, item.profit].every((metric) => metric === null || finite(metric)))) return false;
  if (!c.transactionDetails.every((item) => record(item) && (item.date === undefined || (typeof item.date === "string" && item.date.length <= 40)) && record(item.description) && item.description.trust === "untrusted" && typeof item.description.value === "string" && item.description.value.length <= 240 && finite(item.amount))) return false;
  return ["high", "medium", "low"].includes(String(c.quality.level)) && finite(c.quality.confidence) && c.quality.confidence >= 0 && c.quality.confidence <= 100 && finite(c.quality.rowsAnalyzed) && finite(c.quality.rowsSkipped) && Array.isArray(c.quality.warnings) && c.quality.warnings.length <= 8 && c.quality.warnings.every((warning) => record(warning) && warning.trust === "untrusted" && typeof warning.value === "string" && warning.value.length <= 240) && validUnit(c.unit);
}

const numericPattern = /(?:[\d\u0660-\u0669]|\b(?:KWD|KD|USD|EUR|SAR|AED|GBP|CAD|AUD|JPY|BHD|OMR|QAR|JOD)\b|[$\u20ac\u00a3\u00a5%\u066a]|\b(?:percent(?:age)?s?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twice|thrice|double(?:d|s)?|triple(?:d|s)?|half|halves|quarter(?:s|ly)?|hundred|thousand|million|billion)\b|د\s*\.?\s*ك|دينار(?:\s+كويتي)?|ريال(?:\s+سعودي)?|دولار|يورو|(?:^|[^\p{L}])(?:صفر|واحده?|اثنان|اثنين|اثنتان|اثنتين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثمانيه|تسع|تسعه|عشر|عشره|عشرون|ثلاثون|اربعون|خمسون|ستون|سبعون|ثمانون|تسعون|مئه|مئتان|الف|الاف|مليون|ملايين|مليار|مليارات)(?=$|[^\p{L}])|(?:بالمئه|بالمائه|في\s+المئه|في\s+المائه))/iu;
function hasUnsupportedQuantitativeClaim(text: string): boolean {
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  return numericPattern.test(text) || numericPattern.test(normalized);
}
export function validateInterpretation(value: unknown, context: FinancialContext): value is AnalystInterpretation {
  if (!record(value) || (value.provider !== "mock" && value.provider !== "ollama") || typeof value.interpretation !== "string" || !value.interpretation.trim() || value.interpretation.length > 1_000 || !Array.isArray(value.investigateNext) || !Array.isArray(value.factRefs) || !Array.isArray(value.uncertainty)) return false;
  const prose = [value.interpretation, ...value.investigateNext, ...value.uncertainty];
  if (!prose.every((item) => typeof item === "string" && item.length <= 300 && !hasUnsupportedQuantitativeClaim(item))) return false;
  return value.investigateNext.length <= 5 && value.uncertainty.length <= 5 && value.factRefs.length <= 12 && value.factRefs.every((id) => typeof id === "string" && context.facts.some((fact) => fact.id === id));
}
