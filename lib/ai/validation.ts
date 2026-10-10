import type { AnalystInterpretation, AnalystRequest, FinancialContext, FinancialFact } from "./types";

export const DEFAULT_USAGE_POLICY = { maxRequestBytes: 20_000, maxQuestionCharacters: 1_000, maxFacts: 64, maxCategories: 8, maxPeriods: 12, maxTransactions: 3, timeoutMs: 60_000 } as const;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validUnit = (value: unknown): boolean => record(value) && ["known", "unknown", "ambiguous"].includes(String(value.status)) && ["header", "cell", "unknown"].includes(String(value.source)) && (value.code === null || typeof value.code === "string") && Array.isArray(value.candidates) && value.candidates.length <= 8 && value.candidates.every((candidate) => typeof candidate === "string" && candidate.length <= 12) && (value.status !== "known" || typeof value.code === "string") && (value.status !== "ambiguous" || value.code === null);
const validFactUnit = (value: unknown): boolean => record(value) && (value.kind === "percentage" || (value.kind === "currency" && validUnit(value.unit)));
const validPeriod = (value: unknown): boolean => record(value) && typeof value.id === "string" && value.id.length <= 12 && finite(value.rowsAnalyzed) && finite(value.year) && finite(value.month) && value.month >= 1 && value.month <= 12 && [value.revenue, value.expenses, value.profit].every((metric) => metric === null || finite(metric));

export function validateAnalystRequest(value: unknown): value is AnalystRequest {
  if (!record(value) || typeof value.question !== "string" || !value.question.trim() || value.question.length > DEFAULT_USAGE_POLICY.maxQuestionCharacters || !record(value.context)) return false;
  const c = value.context as unknown as FinancialContext;
  if (c.version !== 3 || !Array.isArray(c.facts) || c.facts.length > DEFAULT_USAGE_POLICY.maxFacts || !Array.isArray(c.categories) || c.categories.length > DEFAULT_USAGE_POLICY.maxCategories || !Array.isArray(c.periods) || c.periods.length > 6 || !Array.isArray(c.comparisons) || c.comparisons.length > 5 || !Array.isArray(c.categoryChanges) || c.categoryChanges.length > 4 || !Array.isArray(c.trends) || c.trends.length > 3 || !record(c.largestChanges) || !Array.isArray(c.transactionDetails) || c.transactionDetails.length > DEFAULT_USAGE_POLICY.maxTransactions || !record(c.quality) || !record(c.unit)) return false;
  if (!c.facts.every((fact) => record(fact) && typeof fact.id === "string" && /^fact-[a-f0-9]{8}$/.test(fact.id) && typeof fact.label === "string" && fact.label.length <= 160 && ["verified", "untrusted"].includes(String(fact.labelTrust)) && ["total", "ratio", "category", "period", "comparison"].includes(String(fact.kind)) && finite(fact.value) && validFactUnit(fact.unit) && (fact.kind !== "ratio" || (record(fact.unit) && fact.unit.kind === "percentage")) && (fact.kind === "ratio" || (record(fact.unit) && fact.unit.kind === "currency")))) return false;
  if (new Set(c.facts.map((fact) => fact.id)).size !== c.facts.length) return false;
  const factById = new Map(c.facts.map((fact) => [fact.id, fact]));
  if (!c.categories.every((item, index) => record(item) && item.rank === index + 1 && record(item.label) && item.label.trust === "untrusted" && typeof item.label.value === "string" && item.label.value.length <= 100 && finite(item.expenses) && item.expenses >= 0 && (item.sharePercent === null || (finite(item.sharePercent) && item.sharePercent >= 0 && item.sharePercent <= 100)) && typeof item.factId === "string" && factById.get(item.factId)?.kind === "category" && factById.get(item.factId)?.value === item.expenses && (item.shareFactId === null || (typeof item.shareFactId === "string" && factById.get(item.shareFactId)?.kind === "ratio")))) return false;
  if (!c.periods.every(validPeriod)) return false;
  if (!c.comparisons.every((comparison) => record(comparison) && validPeriod(comparison.earlier) && validPeriod(comparison.later) && c.periods.some((period) => period.id === comparison.earlier.id) && c.periods.some((period) => period.id === comparison.later.id) && [comparison.revenueDelta, comparison.expenseDelta, comparison.profitDelta, comparison.revenuePercentChange, comparison.expensePercentChange, comparison.profitPercentChange].every((value) => value === null || finite(value)))) return false;
  if (!c.categoryChanges.every((change) => record(change) && record(change.label) && change.label.trust === "untrusted" && typeof change.label.value === "string" && c.periods.some((period) => period.id === change.earlierPeriod) && c.periods.some((period) => period.id === change.laterPeriod) && [change.earlierExpenses, change.laterExpenses].every((value) => finite(value) && value >= 0) && finite(change.delta) && change.delta === change.laterExpenses - change.earlierExpenses && [change.earlierFactId, change.laterFactId, change.deltaFactId].every((id) => typeof id === "string" && factById.has(id)))) return false;
  if (!c.trends.every((trend) => record(trend) && ["revenue", "expenses", "profit"].includes(String(trend.metric)) && ["increasing", "decreasing", "stable", "mixed"].includes(String(trend.direction)) && Array.isArray(trend.periodIds) && trend.periodIds.length >= 2 && trend.periodIds.every((id) => c.periods.some((period) => period.id === id)) && Array.isArray(trend.factRefs) && trend.factRefs.length > 0 && trend.factRefs.every((id) => factById.get(id)?.kind === "comparison"))) return false;
  for (const change of [c.largestChanges.positive, c.largestChanges.negative]) {
    if (change === null) continue;
    if (!record(change) || !record(change.label) || typeof change.label.value !== "string" || !["verified", "untrusted"].includes(String(change.label.trust)) || !c.periods.some((period) => period.id === change.earlierPeriod) || !c.periods.some((period) => period.id === change.laterPeriod) || !finite(change.delta) || typeof change.factId !== "string" || factById.get(change.factId)?.value !== change.delta) return false;
  }
  if (!c.transactionDetails.every((item) => record(item) && (item.date === undefined || (typeof item.date === "string" && item.date.length <= 40)) && record(item.description) && item.description.trust === "untrusted" && typeof item.description.value === "string" && item.description.value.length <= 240 && finite(item.amount))) return false;
  if (!( ["high", "medium", "low"].includes(String(c.quality.level)) && finite(c.quality.confidence) && c.quality.confidence >= 0 && c.quality.confidence <= 100 && finite(c.quality.rowsAnalyzed) && finite(c.quality.rowsSkipped) && Array.isArray(c.quality.warnings) && c.quality.warnings.length <= 8 && c.quality.warnings.every((warning) => record(warning) && warning.trust === "untrusted" && typeof warning.value === "string" && warning.value.length <= 240) && validUnit(c.unit))) return false;
  return true;
}

const numericPattern = /(?:[\d\u0660-\u0669]|\b(?:KWD|KD|USD|EUR|SAR|AED|GBP|CAD|AUD|JPY|BHD|OMR|QAR|JOD)\b|[$\u20ac\u00a3\u00a5%\u066a]|\b(?:percent(?:age)?s?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twice|thrice|double(?:d|s)?|triple(?:d|s)?|half|halves|quarter(?:s|ly)?|hundred|thousand|million|billion)\b|د\s*\.?\s*ك|دينار(?:\s+كويتي)?|ريال(?:\s+سعودي)?|دولار|يورو|(?:^|[^\p{L}])(?:صفر|واحده?|اثنان|اثنين|اثنتان|اثنتين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثمانيه|تسع|تسعه|عشر|عشره|عشرون|ثلاثون|اربعون|خمسون|ستون|سبعون|ثمانون|تسعون|مئه|مئتان|الف|الاف|مليون|ملايين|مليار|مليارات)(?=$|[^\p{L}])|(?:بالمئه|بالمائه|في\s+المئه|في\s+المائه))/iu;
const arabicQuantitativePattern = /(?:د\s*\.?\s*ك|دينار(?:\s+كويتي)?|ريال(?:\s+سعودي)?|دولار|يورو|(?:^|[^\p{L}])(?:صفر|واحده?|اثنان|اثنين|اثنتان|اثنتين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثمانيه|تسع|تسعه|عشر|عشره|عشرون|ثلاثون|اربعون|خمسون|ستون|سبعون|ثمانون|تسعون|مئه|مئتان|الف|الاف|مليون|ملايين|مليار|مليارات)(?=$|[^\p{L}])|(?:بالمئه|في\s+المئه|نصف|ربع|مرتين|ثلاث\s+مرات))/iu;
const unicodeArabicQuantitativePattern = /(?:\u062F\s*\.?\s*\u0643|\u062F\u064A\u0646\u0627\u0631(?:\s+\u0643\u0648\u064A\u062A\u064A)?|\u0631\u064A\u0627\u0644(?:\s+\u0633\u0639\u0648\u062F\u064A)?|\u062F\u0648\u0644\u0627\u0631|\u064A\u0648\u0631\u0648|(?:^|[^\p{L}])(?:\u0635\u0641\u0631|\u0648\u0627\u062D\u062F\u0629?|\u0627\u062B\u0646\u0627\u0646|\u0627\u062B\u0646\u064A\u0646|\u0627\u062B\u0646\u062A\u0627\u0646|\u0627\u062B\u0646\u062A\u064A\u0646|\u062B\u0644\u0627\u062B|\u062B\u0644\u0627\u062B\u0629|\u0627\u0631\u0628\u0639|\u0627\u0631\u0628\u0639\u0629|\u062E\u0645\u0633|\u062E\u0645\u0633\u0629|\u0633\u062A|\u0633\u062A\u0629|\u0633\u0628\u0639|\u0633\u0628\u0639\u0629|\u062B\u0645\u0627\u0646|\u062B\u0645\u0627\u0646\u064A\u0629|\u062A\u0633\u0639|\u062A\u0633\u0639\u0629|\u0639\u0634\u0631|\u0639\u0634\u0631\u0629|\u0639\u0634\u0631\u0648\u0646|\u062B\u0644\u0627\u062B\u0648\u0646|\u0627\u0631\u0628\u0639\u0648\u0646|\u062E\u0645\u0633\u0648\u0646|\u0633\u062A\u0648\u0646|\u0633\u0628\u0639\u0648\u0646|\u062B\u0645\u0627\u0646\u0648\u0646|\u062A\u0633\u0639\u0648\u0646|\u0645\u0626\u0629|\u0645\u0626\u062A\u0627\u0646|\u0627\u0644\u0641|\u0627\u0644\u0627\u0641|\u0645\u0644\u064A\u0648\u0646|\u0645\u0644\u0627\u064A\u064A\u0646|\u0645\u0644\u064A\u0627\u0631|\u0645\u0644\u064A\u0627\u0631\u0627\u062A)(?=$|[^\p{L}])|(?:\u0628\u0627\u0644\u0645\u0626\u0629|\u0641\u064A\s+\u0627\u0644\u0645\u0626\u0629|\u0646\u0635\u0641|\u0631\u0628\u0639|\u0645\u0631\u062A\u064A\u0646|\u062B\u0644\u0627\u062B\s+\u0645\u0631\u0627\u062A))/iu;
function normalizeText(text: string): string {
  return text.toLocaleLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
}
function hasUnsupportedQuantitativeClaim(text: string): boolean {
  if (arabicQuantitativePattern.test(text) || unicodeArabicQuantitativePattern.test(text)) return true;
  const normalized = normalizeText(text);
  return numericPattern.test(text) || numericPattern.test(normalized);
}

const unsupportedConcepts: Array<{ name: string; pattern: RegExp }> = [
  { name: "transfers", pattern: /\b(?:bank\s+)?transfers?\b|تحويل(?:ات)?|حوالات?/iu },
  { name: "operations", pattern: /\boperations?\b|العمليات?/iu },
  { name: "customers", pattern: /\b(?:customers?|clients?)\b|العملاء?|زبائن?/iu },
  { name: "cash flow", pattern: /\bcash[\s-]*flow\b|التدفق النقدي|السيوله/iu },
  { name: "inventory", pattern: /\binventor(?:y|ies)\b|المخزون/iu },
  { name: "taxes", pattern: /\btaxes?\b|الضرائب?/iu },
  { name: "suppliers", pattern: /\b(?:suppliers?|vendors?)\b|المورد(?:ون|ين)/iu },
  { name: "loans", pattern: /\b(?:loans?|debt|liabilities)\b|القروض?|الديون|الالتزامات/iu },
  { name: "interest", pattern: /\binterest\b|الفوائد?/iu },
  { name: "insurance", pattern: /\binsurance\b|التامين|التأمين/iu },
  { name: "travel", pattern: /\btravel\b|السفر/iu },
  { name: "utilities", pattern: /\butilities\b|المرافق/iu },
  { name: "maintenance", pattern: /\bmaintenance\b|الصيانه|الصيانة/iu },
  { name: "subscriptions", pattern: /\bsubscriptions?\b|الاشتراكات/iu },
  { name: "supplies", pattern: /\b(?:supplies|office supplies)\b|المستلزمات|القرطاسيه|القرطاسية/iu },
  { name: "equipment", pattern: /\bequipment\b|المعدات/iu },
  { name: "fuel", pattern: /\bfuel\b|الوقود/iu },
  { name: "advertising", pattern: /\badvertising\b|الاعلان|الإعلان/iu },
  { name: "shipping", pattern: /\bshipping\b|الشحن/iu },
  { name: "bank fees", pattern: /\bbank fees?\b|رسوم بنكيه|رسوم بنكية/iu },
  { name: "depreciation", pattern: /\bdepreciation\b|الاستهلاك/iu },
  { name: "commission", pattern: /\bcommissions?\b|العمولات/iu },
  { name: "food", pattern: /\bfood\b|الطعام|الاغذيه|الأغذية/iu },
];
const unsupportedArabicConcepts: Array<{ name: string; pattern: RegExp }> = [
  { name: "transfers", pattern: /تحويل(?:ات)?|حوالات?/u },
  { name: "operations", pattern: /العمليات?/u },
  { name: "customers", pattern: /العملاء?|زبائن?/u },
  { name: "cash flow", pattern: /التدفق النقدي|السيوله/u },
  { name: "inventory", pattern: /المخزون/u },
  { name: "taxes", pattern: /الضرائب?/u },
  { name: "suppliers", pattern: /المورد(?:ون|ين)/u },
  { name: "loans", pattern: /القروض?|الديون|الالتزامات/u },
  { name: "interest", pattern: /الفوائد?/u },
  { name: "insurance", pattern: /التأمين/u },
  { name: "travel", pattern: /السفر/u },
  { name: "utilities", pattern: /المرافق/u },
  { name: "maintenance", pattern: /الصيانة/u },
  { name: "subscriptions", pattern: /الاشتراكات/u },
  { name: "supplies", pattern: /المستلزمات|القرطاسية/u },
  { name: "equipment", pattern: /المعدات/u },
  { name: "fuel", pattern: /الوقود/u },
  { name: "advertising", pattern: /الإعلان|الاعلان/u },
  { name: "shipping", pattern: /الشحن/u },
  { name: "bank fees", pattern: /رسوم بنكية|رسوم بنكيه/u },
  { name: "depreciation", pattern: /الاستهلاك/u },
  { name: "commission", pattern: /العمولات/u },
  { name: "food", pattern: /الطعام|الأغذية|الاغذيه/u },
];
const unicodeArabicUnsupportedConcepts: Array<{ name: string; pattern: RegExp }> = [
  { name: "transfers", pattern: /\u062A\u062D\u0648\u064A\u0644(?:\u0627\u062A)?|\u062D\u0648\u0627\u0644\u0627\u062A?/u },
  { name: "operations", pattern: /\u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A?/u },
  { name: "customers", pattern: /\u0627\u0644\u0639\u0645\u0644\u0627\u0621?|\u0632\u0628\u0627\u0626\u0646?/u },
  { name: "cash flow", pattern: /\u0627\u0644\u062A\u062F\u0641\u0642\s+\u0627\u0644\u0646\u0642\u062F\u064A|\u0627\u0644\u0633\u064A\u0648\u0644\u0647/u },
  { name: "inventory", pattern: /\u0627\u0644\u0645\u062E\u0632\u0648\u0646/u },
  { name: "taxes", pattern: /\u0627\u0644\u0636\u0631\u0627\u0626\u0628?/u },
  { name: "suppliers", pattern: /\u0627\u0644\u0645\u0648\u0631\u062F(?:\u0648\u0646|\u064A\u0646)/u },
  { name: "loans", pattern: /\u0627\u0644\u0642\u0631\u0648\u0636?|\u0627\u0644\u062F\u064A\u0648\u0646|\u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645\u0627\u062A/u },
  { name: "interest", pattern: /\u0627\u0644\u0641\u0648\u0627\u0626\u062F?/u },
  { name: "insurance", pattern: /\u0627\u0644\u062A\u0623\u0645\u064A\u0646|\u0627\u0644\u062A\u0627\u0645\u064A\u0646/u },
  { name: "travel", pattern: /\u0627\u0644\u0633\u0641\u0631/u },
  { name: "utilities", pattern: /\u0627\u0644\u0645\u0631\u0627\u0641\u0642/u },
  { name: "maintenance", pattern: /\u0627\u0644\u0635\u064A\u0627\u0646\u0629/u },
  { name: "subscriptions", pattern: /\u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643\u0627\u062A/u },
  { name: "supplies", pattern: /\u0627\u0644\u0645\u0633\u062A\u0644\u0632\u0645\u0627\u062A|\u0627\u0644\u0642\u0631\u0637\u0627\u0633\u064A\u0629/u },
  { name: "equipment", pattern: /\u0627\u0644\u0645\u0639\u062F\u0627\u062A/u },
  { name: "fuel", pattern: /\u0627\u0644\u0648\u0642\u0648\u062F/u },
  { name: "advertising", pattern: /\u0627\u0644\u0625\u0639\u0644\u0627\u0646|\u0627\u0644\u0627\u0639\u0644\u0627\u0646/u },
  { name: "shipping", pattern: /\u0627\u0644\u0634\u062D\u0646/u },
  { name: "bank fees", pattern: /\u0631\u0633\u0648\u0645\s+\u0628\u0646\u0643\u064A\u0629|\u0631\u0633\u0648\u0645\s+\u0628\u0646\u0643\u064A\u0647/u },
  { name: "depreciation", pattern: /\u0627\u0644\u0627\u0633\u062A\u0647\u0644\u0627\u0643/u },
  { name: "commission", pattern: /\u0627\u0644\u0639\u0645\u0648\u0644\u0627\u062A/u },
  { name: "food", pattern: /\u0627\u0644\u0637\u0639\u0627\u0645|\u0627\u0644\u0623\u063A\u0630\u064A\u0629|\u0627\u0644\u0627\u063A\u0630\u064A\u0647/u },
];
const monthMentions: Array<{ month: number; pattern: RegExp }> = [
  { month: 1, pattern: /\b(?:January|Jan)\b|يناير|كانون الثاني/u },
  { month: 2, pattern: /\b(?:February|Feb)\b|فبراير|شباط/u },
  { month: 3, pattern: /\b(?:March|Mar)\b|مارس|اذار|آذار/u },
  { month: 4, pattern: /\b(?:April|Apr)\b|ابريل|أبريل|نيسان/u },
  { month: 5, pattern: /\bMay\b|مايو|أيار/u },
  { month: 6, pattern: /\b(?:June|Jun)\b|يونيو|حزيران/u },
  { month: 7, pattern: /\b(?:July|Jul)\b|يوليو|تموز/u },
  { month: 8, pattern: /\b(?:August|Aug)\b|اغسطس|أغسطس/u },
  { month: 9, pattern: /\b(?:September|Sep)\b|سبتمبر|ايلول|أيلول/u },
  { month: 10, pattern: /\b(?:October|Oct)\b|اكتوبر|أكتوبر|تشرين الاول|تشرين الأول/u },
  { month: 11, pattern: /\b(?:November|Nov)\b|نوفمبر|تشرين الثاني/u },
  { month: 12, pattern: /\b(?:December|Dec)\b|ديسمبر|كانون الاول|كانون الأول/u },
];
function contextConceptText(context: FinancialContext): string {
  return [
    ...context.facts.map((fact) => fact.label),
    ...context.categories.map((category) => category.label.value),
    ...context.periods.flatMap((period) => [period.id, period.label]),
    ...context.categoryChanges.map((change) => change.label.value),
  ].join(" ");
}
function unsupportedConceptNames(text: string, context: FinancialContext): string[] {
  const available = normalizeText(contextConceptText(context));
  return [...unsupportedConcepts, ...unsupportedArabicConcepts, ...unicodeArabicUnsupportedConcepts].filter(({ pattern }) => pattern.test(text) && !pattern.test(available)).map(({ name }) => name);
}
const arabicMonthMentions: Array<{ month: number; pattern: RegExp }> = [
  { month: 1, pattern: /يناير|كانون الثاني/u }, { month: 2, pattern: /فبراير|شباط/u },
  { month: 3, pattern: /مارس|اذار/u }, { month: 4, pattern: /ابريل|نيسان/u },
  { month: 5, pattern: /مايو|ايار/u }, { month: 6, pattern: /يونيو|حزيران/u },
  { month: 7, pattern: /يوليو|تموز/u }, { month: 8, pattern: /اغسطس/u },
  { month: 9, pattern: /سبتمبر|ايلول/u }, { month: 10, pattern: /اكتوبر|تشرين الاول/u },
  { month: 11, pattern: /نوفمبر|تشرين الثاني/u }, { month: 12, pattern: /ديسمبر|كانون الاول/u },
];
const unicodeArabicMonthMentions: Array<{ month: number; pattern: RegExp }> = [
  { month: 1, pattern: /\u064A\u0646\u0627\u064A\u0631|\u0643\u0627\u0646\u0648\u0646\s+\u0627\u0644\u062B\u0627\u0646\u064A/u },
  { month: 2, pattern: /\u0641\u0628\u0631\u0627\u064A\u0631|\u0634\u0628\u0627\u0637/u },
  { month: 3, pattern: /\u0645\u0627\u0631\u0633|\u0627\u0630\u0627\u0631/u },
  { month: 4, pattern: /\u0627\u0628\u0631\u064A\u0644|\u0646\u064A\u0633\u0627\u0646/u },
  { month: 5, pattern: /\u0645\u0627\u064A\u0648|\u0627\u064A\u0627\u0631/u },
  { month: 6, pattern: /\u064A\u0648\u0646\u064A\u0648|\u062D\u0632\u064A\u0631\u0627\u0646/u },
  { month: 7, pattern: /\u064A\u0648\u0644\u064A\u0648|\u062A\u0645\u0648\u0632/u },
  { month: 8, pattern: /\u0627\u063A\u0633\u0637\u0633/u },
  { month: 9, pattern: /\u0633\u0628\u062A\u0645\u0628\u0631|\u0627\u064A\u0644\u0648\u0644/u },
  { month: 10, pattern: /\u0627\u0643\u062A\u0648\u0628\u0631|\u062A\u0634\u0631\u064A\u0646\s+\u0627\u0644\u0627\u0648\u0644/u },
  { month: 11, pattern: /\u0646\u0648\u0641\u0645\u0628\u0631|\u062A\u0634\u0631\u064A\u0646\s+\u0627\u0644\u062B\u0627\u0646\u064A/u },
  { month: 12, pattern: /\u062F\u064A\u0633\u0645\u0628\u0631|\u0643\u0627\u0646\u0648\u0646\s+\u0627\u0644\u0627\u0648\u0644/u },
];
function hasUnsupportedPeriod(text: string, context: FinancialContext): boolean {
  return [...monthMentions, ...arabicMonthMentions, ...unicodeArabicMonthMentions].some(({ month, pattern }) => pattern.test(text) && !context.periods.some((period) => period.month === month));
}
function containsLabel(text: string, label: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel) return false;
  if (/^[a-z0-9 ]+$/i.test(label)) {
    const escaped = normalizedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").trim().replace(/\s+/g, "\\s+");
    return new RegExp(`\\b${escaped}\\b`, "i").test(normalizedText);
  }
  return normalizedText.includes(normalizedLabel);
}
function categoryLabelAliases(label: string): string[] {
  const normalized = normalizeText(label);
  const aliases: Record<string, string[]> = {
    payroll: ["\\u0627\\u0644\\u0631\\u0648\\u0627\\u062A\\u0628", "\\u0631\\u0648\\u0627\\u062A\\u0628"],
    rent: ["\\u0627\\u0644\\u0625\\u064A\\u062C\\u0627\\u0631", "\\u0627\\u0644\\u0627\\u064A\\u062C\\u0627\\u0631", "\\u0625\\u064A\\u062C\\u0627\\u0631", "\\u0627\\u064A\\u062C\\u0627\\u0631"],
    marketing: ["\\u0627\\u0644\\u062A\\u0633\\u0648\\u064A\\u0642", "\\u062A\\u0633\\u0648\\u064A\\u0642"],
    software: ["\\u0627\\u0644\\u0628\\u0631\\u0645\\u062C\\u064A\\u0627\\u062A", "\\u0628\\u0631\\u0645\\u062C\\u064A\\u0627\\u062A", "\\u0627\\u0644\\u0628\\u0631\\u0627\\u0645\\u062C", "\\u0628\\u0631\\u0627\\u0645\\u062C"],
  };
  return (aliases[normalized] ?? []).map((value) => value.replace(/\\u([0-9a-f]{4})/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16))));
}
function containsCategoryLabel(text: string, label: string): boolean {
  return containsLabel(text, label) || categoryLabelAliases(label).some((alias) => containsLabel(text, alias));
}
function categoryFactIds(context: FinancialContext, categoryLabel: string): string[] {
  const category = context.categories.find((entry) => normalizeText(entry.label.value) === normalizeText(categoryLabel));
  if (!category) return [];
  return [category.factId, ...(category.shareFactId ? [category.shareFactId] : []), ...context.categoryChanges.filter((change) => normalizeText(change.label.value) === normalizeText(categoryLabel)).flatMap((change) => [change.earlierFactId, change.laterFactId, change.deltaFactId])];
}
export function completeCategoryFactRefs(value: unknown, context: FinancialContext, allowedIds: ReadonlySet<string>): unknown {
  if (!record(value) || !Array.isArray(value.factRefs) || !Array.isArray(value.investigateNext) || !Array.isArray(value.uncertainty) || typeof value.interpretation !== "string") return value;
  const prose = [value.interpretation, ...value.investigateNext, ...value.uncertainty].filter((item): item is string => typeof item === "string").join(" ");
  const refs = new Set(value.factRefs.filter((id): id is string => typeof id === "string"));
  for (const category of context.categories.slice(0, 4)) {
    if (allowedIds.has(category.factId) && containsCategoryLabel(prose, category.label.value)) refs.add(category.factId);
  }
  return { ...value, factRefs: [...refs] };
}
function hasArabicExpenseDriverTerms(text: string): boolean {
  return /\u0645\u0635\u0631\u0648\u0641|\u0645\u0635\u0627\u0631\u064A\u0641|\u0646\u0641\u0642\u0627\u062A|\u0627\u0646\u0641\u0627\u0642|\u0648\u064A\u0646|\u0627\u0644\u0645\u0634\u0643\u0644\u0629?|\u0627\u0644\u062E\u0644\u0644|\u0627\u0646\u062A\u0628\u0627\u0647|\u0627\u0631\u0627\u062C\u0639|\u062A\u0646\u0635\u062D|\u0627\u0646\u0635\u062D/iu.test(text);
}
function hasArabicProfitChangeTerms(text: string): boolean {
  return /\u0631\u0628\u062D|\u0627\u0644\u0631\u0628\u062D/iu.test(text) && /\u062A\u063A\u064A\u0631|\u0646\u0627\u0632\u0644|\u0645\u0631\u062A\u0641\u0639|\u0644\u064A\u0634|\u0644\u0645\u0627\u0630\u0627/iu.test(text);
}
function hasArabicBroadInvestigationTerms(text: string): boolean {
  return /\u0648\u064A\u0646|\u0627\u0644\u0645\u0634\u0643\u0644\u0629?|\u0627\u0644\u062E\u0644\u0644|\u0627\u0631\u0627\u062C\u0639|\u062A\u0646\u0635\u062D|\u0627\u0646\u0635\u062D|\u0627\u0646\u062A\u0628\u0627\u0647|\u062A\u063A\u064A\u0631|\u0646\u0627\u0632\u0644|\u0645\u0631\u062A\u0641\u0639|\u0631\u0628\u062D/iu.test(text);
}
function isBroadInvestigation(text: string): boolean {
  if (hasArabicBroadInvestigationTerms(text)) return true;
  if (/وين|المشكل(?:ة|ه)|الخلل|اراجع|تنصح|انصح|انتباه|تغير|نازل|مرتفع|ربح/iu.test(text)) return true;
  return /\b(?:problem|issue|review|investigat\w*|attention|recommend\w*|change|trend|decreas\w*|increas\w*|profitability)\b|وين|المشكله|الخلل|أراجع|اراجع|تنصح|انتباه|تغير|نازل|مرتفع|ربحي|الربح/iu.test(text);
}
function referencesRelevantFacts(value: Record<string, unknown>, context: FinancialContext, question?: string): boolean {
  const refs = value.factRefs as string[];
  if (context.facts.length > 0 && refs.length === 0) return false;
  const prose = [value.interpretation, ...(value.investigateNext as string[]), ...(value.uncertainty as string[])].join(" ");
  const content = `${String(value.interpretation)} ${prose}`;
  const text = normalizeText(content);
  const cited = new Set(refs);
  const questionText = normalizeText(question ?? "");
  const asksExpenseDrivers = /\b(?:expense|expenses|spending|cost|costs|problem|issue|attention|review|recommend|investigat)\b|Ø§Ù„Ù…ØµØ±ÙˆÙ|Ù…ØµØ§Ø±ÙŠÙ|Ù†ÙÙ‚Ø§Øª|ÙˆÙŠÙ†|Ø§Ù„Ù…Ø´ÙƒÙ„Ù‡|Ø§Ù„Ø®Ù„Ù„|Ø§Ù†ØªØ¨Ø§Ù‡|Ø£Ø±Ø§Ø¬Ø¹|Ø§Ø±Ø§Ø¬Ø¹|ØªÙ†ØµØ­|Ø£Ø±Ø§Ø¬Ø¹/iu.test(questionText);
  const asksProfitTrend = /\bprofit\b|Ø§Ù„Ø±Ø¨Ø­|Ø±Ø¨Ø­/iu.test(questionText) && /\b(?:change|changed|trend|decreas|increase|fall|drop|why)\b|ØªØºÙŠØ±|Ù†Ø§Ø²Ù„|Ù…Ø±ØªÙØ¹|Ù„ÙŠØ´/iu.test(questionText);
  const asksExpenseDriversArabic = hasArabicExpenseDriverTerms(question ?? "");
  if ((asksExpenseDrivers || asksExpenseDriversArabic) && !context.categories.slice(0, 4).some((category) => categoryFactIds(context, category.label.value).some((id) => cited.has(id)))) return false;
  const asksProfitTrendArabic = hasArabicProfitChangeTerms(question ?? "");
  if (asksProfitTrend || asksProfitTrendArabic) {
    const citedProfitPair = refs.map((id) => context.facts.find((candidate) => candidate.id === id))
      .find((fact) => fact?.kind === "comparison" && /profit|Ø±Ø¨Ø­/iu.test(fact.label))?.label.replace(/\s+profit delta$/i, "");
    if (!citedProfitPair || !["revenue", "expenses"].every((metric) => refs.some((id) => {
      const fact = context.facts.find((candidate) => candidate.id === id);
      return fact?.kind === "comparison" && fact.label === `${citedProfitPair} ${metric} delta`;
    }))) return false;
  }
  if (asksExpenseDrivers || asksExpenseDriversArabic) {
    const relevantExpenseIds = new Set([
      ...context.categories.slice(0, 4).flatMap((category) => categoryFactIds(context, category.label.value)),
      ...context.facts.filter((fact) => fact.kind === "comparison" && /(?:revenue|expenses|profit) delta$/i.test(fact.label)).map((fact) => fact.id),
    ]);
    if (!context.categories.slice(0, 4).some((category) => refs.some((id) => categoryFactIds(context, category.label.value).includes(id)))) return false;
    for (const category of context.categories.slice(0, 4)) {
      if (containsCategoryLabel(prose, category.label.value) && !categoryFactIds(context, category.label.value).some((id) => cited.has(id))) return false;
    }
    const claimsProfit = /\b(?:profit|earnings|net result|profitability)\b|\u0631\u0628\u062D|\u0627\u0644\u0631\u0628\u062D/iu.test(text);
    const claimsRevenue = /\b(?:revenue|income|sales)\b|\u0627\u0644\u0625\u064A\u0631\u0627\u062F|\u0625\u064A\u0631\u0627\u062F|\u0627\u0644\u062F\u062E\u0644/iu.test(text);
    if (claimsProfit && !refs.some((id) => context.facts.some((fact) => fact.id === id && /profit|earnings/i.test(fact.label)))) return false;
    if (claimsRevenue && !refs.some((id) => context.facts.some((fact) => fact.id === id && /revenue|income|sales/i.test(fact.label)))) return false;
    const claimsRatio = /\b(?:ratio|margin|share|portion|percent)\b|\u0646\u0633\u0628\u0629|\u0647\u0627\u0645\u0634|\u062D\u0635\u0629/iu.test(text);
    if (claimsRatio && !refs.some((id) => context.facts.some((fact) => fact.id === id && fact.kind === "ratio"))) return false;
    return refs.every((id) => relevantExpenseIds.has(id));
  }
  for (const category of context.categories) {
    if (category.label.value.toLowerCase() === "other") continue;
    if (containsCategoryLabel(prose, category.label.value) && !categoryFactIds(context, category.label.value).some((id) => cited.has(id))) return false;
  }
  const requireMetricRef = (pattern: RegExp, factMatches: (fact: FinancialFact) => boolean): boolean => !pattern.test(text) || refs.some((id) => {
    const fact = context.facts.find((item) => item.id === id);
    return fact !== undefined && factMatches(fact);
  });
  if (!requireMetricRef(/\b(?:profit|earnings|net result|profitability)\b|ربح|الربحيه/u, (fact) => /profit|ربح/iu.test(fact.label))) return false;
  if (!requireMetricRef(/\b(?:revenue|income|sales)\b|ايراد|دخل/u, (fact) => /revenue|income|sales|ايراد|دخل/iu.test(fact.label))) return false;
  if (!requireMetricRef(/\b(?:expense|expenses|spending|costs?)\b|مصروف|مصاريف|نفقات|انفاق/u, (fact) => fact.kind === "category" || /expense|cost|مصروف|مصاريف|نفقات|انفاق/iu.test(fact.label))) return false;
  const trendMentioned = /\b(?:change|changed|trend|increased|decreased|month|period|comparison)\b|تغير|تغيّر|نازل|مرتفع|انخفض|زاد|ارتفع|شهري/iu.test(text) || monthMentions.some(({ pattern }) => pattern.test(content));
  if (trendMentioned && !refs.some((id) => context.facts.some((fact) => fact.id === id && (fact.kind === "period" || fact.kind === "comparison")))) return false;
  const broad = isBroadInvestigation(text) || isBroadInvestigation(question ?? "") || asksExpenseDrivers || asksExpenseDriversArabic;
  for (const id of refs) {
    const fact = context.facts.find((candidate) => candidate.id === id);
    if (!fact) return false;
    const category = context.categories.find((candidate) => candidate.factId === id || candidate.shareFactId === id);
    const categoryChange = context.categoryChanges.find((candidate) => [candidate.earlierFactId, candidate.laterFactId, candidate.deltaFactId].includes(id));
    if (category || categoryChange) {
      const label = category?.label.value ?? categoryChange?.label.value ?? "";
      if (!containsLabel(prose, label) && !(broad && (category?.rank ?? 99) <= 4)) return false;
    } else if (fact.kind === "ratio" && !/\b(?:margin|ratio|share|portion|percent)\b|نسبه|هامش|حصه|حصة|نصيبا|نصيب/iu.test(text)) {
      return false;
    } else if ((fact.kind === "period" || fact.kind === "comparison") && !trendMentioned && !broad) {
      return false;
    } else if (fact.kind === "total" && !broad && !containsLabel(text, fact.label)) {
      return false;
    }
  }
  return true;
}

export function getInterpretationValidationIssues(value: unknown, context: FinancialContext, question?: string): string[] {
  if (!record(value) || (value.provider !== "mock" && value.provider !== "ollama") || typeof value.interpretation !== "string" || !value.interpretation.trim() || value.interpretation.length > 220 || !Array.isArray(value.investigateNext) || !Array.isArray(value.factRefs) || !Array.isArray(value.uncertainty)) return ["malformed_response"];
  const prose = [value.interpretation, ...value.investigateNext, ...value.uncertainty];
  if (typeof value.interpretation !== "string" || !value.investigateNext.every((item) => typeof item === "string" && item.length <= 180) || !value.uncertainty.every((item) => typeof item === "string" && item.length <= 180)) return ["malformed_prose"];
  const issues: string[] = [];
  if (prose.some(hasUnsupportedQuantitativeClaim)) issues.push("unsupported_quantitative_claim");
  const unsupportedNames = [...new Set(prose.flatMap((item) => unsupportedConceptNames(item, context)))];
  if (unsupportedNames.length) issues.push(...unsupportedNames.map((name) => `unsupported_concept:${name}`));
  if (prose.some((item) => hasUnsupportedPeriod(item, context))) issues.push("unsupported_period");
  if (value.investigateNext.length > 3 || value.uncertainty.length > 2 || value.factRefs.length > 6) issues.push("response_limit_exceeded");
  if (!value.factRefs.every((id) => typeof id === "string" && context.facts.some((fact) => fact.id === id))) issues.push("unknown_fact_reference");
  if (context.facts.length > 0 && value.factRefs.length === 0) issues.push("missing_fact_reference");
  if (!referencesRelevantFacts(value, context, question)) {
    issues.push("irrelevant_fact_reference");
    const questionText = normalizeText(question ?? "");
    if (/\bprofit\b|Ø§Ù„Ø±Ø¨Ø­|Ø±Ø¨Ø­/iu.test(questionText) && /\b(?:change|changed|trend|decreas|increase|fall|drop|why)\b|ØªØºÙŠØ±|Ù†Ø§Ø²Ù„|Ù…Ø±ØªÙØ¹|Ù„ÙŠØ´/iu.test(questionText)) issues.push("missing_profit_driver_comparisons");
    if (hasArabicProfitChangeTerms(question ?? "")) issues.push("missing_profit_driver_comparisons");
  }
  return issues;
}

export function validateInterpretation(value: unknown, context: FinancialContext, question?: string): value is AnalystInterpretation {
  return getInterpretationValidationIssues(value, context, question).length === 0;
}
