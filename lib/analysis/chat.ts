import type { FinancialDataset, FinancialFactUnit } from "@/lib/financial/types";
import { formatFinancialAmount } from "@/lib/financial/unit";
import { createFinancialContext } from "@/lib/ai/context";
import type { AnalystInterpretation, AnalystRequest, FinancialContext, FinancialTrend } from "@/lib/ai/types";

export type FinancialQuestionIntent =
  | "deterministic_metric"
  | "category_ranking"
  | "category_metric"
  | "interpretive_financial"
  | "recommendation_investigation"
  | "unsupported_general";

export type ChatRoutingResult =
  | { route: "local"; intent: FinancialQuestionIntent; text: string }
  | { route: "local"; intent: "accounting_ledger"; text: string }
  | { route: "analyst"; intent: "interpretive_financial" | "recommendation_investigation"; interpretation: AnalystInterpretation; facts: Array<{ label: string; value: number; unit: FinancialFactUnit }> };

export type AnalystRequestHandler = (request: AnalystRequest) => Promise<AnalystInterpretation>;

function directionForValue(value: number | undefined): FinancialTrend["direction"] {
  return value === undefined ? "mixed" : value === 0 ? "stable" : value > 0 ? "increasing" : "decreasing";
}

function prioritizeContextFacts(context: FinancialContext, question: string): FinancialContext {
  const normalized = normalizeQuestion(question);
  const isProfitChange = /\bprofit\b|\u0631\u0628\u062D|\u0627\u0644\u0631\u0628\u062D/u.test(normalized) && /\b(?:change|changed|why|trend|decreas|increase|fall|drop)\b|\u062A\u063A\u064A\u0631|\u0646\u0627\u0632\u0644|\u0645\u0631\u062A\u0641\u0639|\u0644\u064A\u0634/u.test(normalized);
  const isExpenseInvestigation = /\b(?:expense|spending|cost|problem|issue|attention|review|recommend|investigat)\b|\u0645\u0635\u0631\u0648\u0641|\u0645\u0635\u0627\u0631\u064A\u0641|\u0646\u0641\u0642\u0627\u062A|\u0648\u064A\u0646|\u0645\u0634\u0643\u0644|\u0627\u0646\u062A\u0628\u0627\u0647|\u062A\u0646\u0635\u062D|\u0627\u0631\u0627\u062C\u0639/u.test(normalized);
  const comparison = context.comparisons.at(-1);
  if (isProfitChange && comparison) {
    const periodIds = new Set([comparison.earlier.id, comparison.later.id]);
    const pair = `${comparison.earlier.id} to ${comparison.later.id}`;
    const facts = ["revenue", "expenses", "profit"].flatMap((metric) => {
      const fact = context.facts.find((candidate) => candidate.kind === "comparison" && candidate.label === `${pair} ${metric} delta`);
      return fact ? [fact] : [];
    });
    return {
      ...context,
      facts,
      categories: [],
      periods: context.periods.filter((period) => periodIds.has(period.id)),
      comparisons: [comparison],
      categoryChanges: [],
      trends: context.trends.filter((trend) => ["revenue", "expenses", "profit"].includes(trend.metric)).map((trend) => {
        const fact = facts.find((candidate) => candidate.label === `${pair} ${trend.metric} delta`);
        return { ...trend, direction: directionForValue(fact?.value), periodIds: [...periodIds], factRefs: fact ? [fact.id] : [] };
      }).filter((trend) => trend.factRefs.length > 0),
      largestChanges: { positive: null, negative: null },
      transactionDetails: [],
    };
  }
  if (isExpenseInvestigation && comparison) {
    const periodIds = new Set([comparison.earlier.id, comparison.later.id]);
    const pair = `${comparison.earlier.id} to ${comparison.later.id}`;
    const isRecommendation = recommendationPattern.test(normalized);
    const categories = context.categories.slice(0, isRecommendation ? 3 : 4);
    const ids = new Set(categories.flatMap((category) => isRecommendation ? [category.factId] : [category.factId, ...(category.shareFactId ? [category.shareFactId] : [])]));
    const periodComparisonFacts = isRecommendation ? [] : context.facts.filter((fact) => fact.kind === "comparison" && fact.label.startsWith(`${pair} `) && /(?:revenue|expenses|profit) delta$/.test(fact.label));
    for (const fact of periodComparisonFacts) ids.add(fact.id);
    return {
      ...context,
      facts: context.facts.filter((fact) => ids.has(fact.id)),
      categories: isRecommendation ? categories.map((category) => ({ ...category, sharePercent: null, shareFactId: null })) : categories,
      periods: isRecommendation ? [] : context.periods.filter((period) => periodIds.has(period.id)),
      comparisons: isRecommendation ? [] : [comparison],
      categoryChanges: [],
      trends: !isRecommendation ? context.trends.filter((trend) => periodComparisonFacts.some((fact) => fact.label === `${pair} ${trend.metric} delta`)).map((trend) => {
        const fact = periodComparisonFacts.find((candidate) => candidate.label === `${pair} ${trend.metric} delta`);
        return { ...trend, direction: directionForValue(fact?.value), periodIds: [...periodIds], factRefs: fact ? [fact.id] : [] };
      }).filter((trend) => trend.factRefs.length > 0) : [],
      largestChanges: { positive: null, negative: null },
      transactionDetails: [],
    };
  }

  return context;
}

const unsupportedResponse = "I can help analyze your uploaded financial data. Ask for a total, an expense category ranking, or what to investigate.";

function normalizeQuestion(question: string): string {
  return question
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

const recommendationPattern = /\b(recommend(?:ation)?s?|suggest(?:ion)?s?|review first|look at first|what should i review|what should i look at|what should i investigate|investigate|investigation|check first|focus on|prioriti[sz]e|needs? attention|worth investigating)\b|تنصح|انصح|راجع|اراجع|نراجع|افحص|افحصه|افحصها|احقق|تحقيق|يحتاج انتباه|تحتاج انتباه|يستحق التحقيق|تستحق التحقيق|اول شي|اولا|ابدا ب|ابدأ ب/u;
const interpretivePattern = /\b(why|how come|explain|analy[sz]e|unusual|anomal(?:y|ies)|pattern|compare|comparison|trend|decreas(?:e|ed|ing)|fell|falling|drop(?:ped|ping)?|increas(?:e|ed|ing)|financial health|business health|outlook|problem|issue|wrong|concern|stand out|important change|important observation|insight|what do you think|tell me about)\b|لماذا|ليش|ليه|شلون|شنو.*(?:ملاحظه|تغيير|وضع|صوره)|وين.*(?:المشكله|الخلل)|غير طبيعي|غير عادي|نازل|منخفض|انخفض|الوضع المالي|الصحه الماليه|ملاحظه|ملاحظات|التغيير الاهم|اهم تغيير|اهم شي|اكثر شي/u;
const implicitDatasetAnalysisPattern = /\b(what stands out|anything unusual|anything abnormal|what changed|key change|main takeaway|what should i review first|what needs attention)\b|هل.*غير\s*(طبيعي|عادي)|شنو.*(?:ملاحظه|تغيير|وضع|صوره)|اهم\s*(ملاحظه|تغيير|شي)|اكثر\s*شي\s*يحتاج\s*انتباه|وين\s*(?:تشوف|تلاحظ)?\s*(?:المشكله|الخلل)/u;
const directMetricPattern = /\b(total|overall|my|what is|what are|how much|show|give me)?\s*(revenue|income|expenses?|spending total|costs?|profit|net result|expense ratio|expense percentage)\b|\b(expense ratio|profit margin)\b|how much.*\b(revenue|income|expense|spend|cost|profit)\b|كم\s*(اجمالي\s*)?(الايراد|الايرادات|الدخل|المصاريف|مصاريفي|المصروفات|نفقاتي|النفقات|ربحي|الربح)|ما\s*(هو|هي)?\s*(اجمالي\s*)?(الايراد|الايرادات|الدخل|المصاريف|مصاريفي|المصروفات|نفقاتي|النفقات|ربحي|الربح)|نسبه\s*(المصاريف|مصاريفي|الصرف)|كم\s*نسبه/u;
const categoryRankingPattern = /\b(highest|top|largest|most expensive)\b.{0,50}\b(expense|spending|cost|categor(?:y|ies))\b|\b(which|what)\b.{0,60}\b(expense|spending|cost) categor(?:y|ies)\b|\b(which|what)\b.{0,45}\b(categories.*expenses)\b|\bmost\b.{0,30}\b(spent|spending)\b|اعل[يى].{0,20}(فئه|تصنيف|مصاريف|مصروف|نفقات)|اكثر\s*(فئه|تصنيف)\s*(من\s*)?(المصاريف|الصرف|انفاق|مصاريف)|ما\s*هي\s*اعل[يى]\s*الفئات|(?:اكثر|اعلى|اكبر)\s*(?:مصروف|مصاريف|نفقه|انفاق)|(?:مصروف|مصاريف|نفقه|انفاق).{0,16}(?:اكثر|اعلى|اكبر)/u;
const financialTopicPattern = /\b(revenue|income|expense|expenses|spending|cost|costs|profit|business|financial|money|cash flow|budget|category|categories)\b|ايراد|ايرادات|دخل|مصروف|مصاريف|نفقات|انفاق|ربح|مالي|ماليه|ميزانيه|سيوله/u;
const analyticalQuestionPattern = /\b(what|why|how|which|where|should|could|tell me|help me|is there|do you)\b|شنو|شو|ايش|كيف|ليش|ليه|وين|هل|وش/u;

const categoryAliases: Record<string, string[]> = {
  payroll: ["payroll", "salary", "salaries", "wage", "wages", "راتب", "رواتب"],
  rent: ["rent", "lease", "ايجار", "الايجار"],
  marketing: ["marketing", "advertising", "تسويق", "التسويق"],
  software: ["software", "saas", "برامج", "البرمجيات"],
  utilities: ["utilities", "utility", "مرافق", "الكهرباء", "الماء"],
  travel: ["travel", "سفر", "السفر"],
};

function categoryValues(dataset: FinancialDataset): Array<{ label: string; expenses: number }> {
  const totals = new Map<string, number>();
  for (const row of dataset.rows) {
    if (!row.analyzed || row.expense <= 0) continue;
    const label = row.category?.trim() || "Uncategorized";
    totals.set(label, (totals.get(label) ?? 0) + row.expense);
  }
  return [...totals.entries()].map(([label, expenses]) => ({ label, expenses }))
    .sort((a, b) => b.expenses - a.expenses || a.label.localeCompare(b.label));
}

function findCategoryMention(question: string, dataset?: FinancialDataset | null): string | null {
  const normalized = normalizeQuestion(question);
  const labels = dataset ? categoryValues(dataset).map((category) => category.label) : Object.keys(categoryAliases);
  const candidates = labels.flatMap((label) => {
    const normalizedLabel = normalizeQuestion(label);
    const aliases = categoryAliases[normalizedLabel] ?? [normalizedLabel];
    return aliases.map((alias) => ({ label, alias: normalizeQuestion(alias) }));
  }).sort((a, b) => b.alias.length - a.alias.length);
  return candidates.find(({ alias }) => alias.length > 1 && normalized.includes(alias))?.label ?? null;
}

const directCategoryAmountPattern = /\b(how much|what did i spend|spent on|spend on|cost of|payroll|salary|salaries|wages|rent|marketing|software)\b|كم|صرف(?:ت)?|مبلغ/u;

type ArabicDirectMetric = "profit" | "revenue" | "expenses";

const arabicDirectMetricPattern = /(?:^|\s)(?:\u0643\u0645|\u0634\u0643\u062B\u0631|\u0634\u0646\u0648)\s*(?:(?:\u0635\u0627\u0641\u064A|\u0627\u062C\u0645\u0627\u0644\u064A)\s*)?(?:\u0637\u0644\u0639\s*)?(?:\u0627\u0644\u0631\u0628\u062D|\u0627\u0644\u0627\u0631\u0628\u0627\u062D|\u0627\u0644\u0627\u064A\u0631\u0627\u062F\u0627\u062A|\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641)(?:\s*(?:\u0627\u0644\u0635\u0627\u0641\u064A|\u0627\u0644\u0627\u062C\u0645\u0627\u0644\u064A))?(?:\s|[؟?]|$)/u;

function getArabicDirectMetric(question: string): ArabicDirectMetric | null {
  const normalized = question.toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    .replace(/\s+/g, " ")
    .trim();
  if (!arabicDirectMetricPattern.test(normalized)) return null;
  if (/\u0627\u0644\u0631\u0628\u062D|\u0627\u0644\u0627\u0631\u0628\u0627\u062D/u.test(normalized)) return "profit";
  if (/\u0627\u0644\u0627\u064A\u0631\u0627\u062F\u0627\u062A/u.test(normalized)) return "revenue";
  return "expenses";
}

export function classifyFinancialQuestion(question: string, dataset?: FinancialDataset | null): FinancialQuestionIntent {
  const normalized = normalizeQuestion(question);
  if (!normalized) return "unsupported_general";

  // Analytical intent wins over metric keywords: "why is profit low?" is not a profit-total request.
  if (recommendationPattern.test(normalized)) return "recommendation_investigation";
  if (interpretivePattern.test(normalized) && (financialTopicPattern.test(normalized) || implicitDatasetAnalysisPattern.test(normalized))) return "interpretive_financial";
  if (categoryRankingPattern.test(normalized)) return "category_ranking";
  if (findCategoryMention(normalized, dataset) && directCategoryAmountPattern.test(normalized)) return "category_metric";
  if (getArabicDirectMetric(question)) return "deterministic_metric";
  if (directMetricPattern.test(normalized)) return "deterministic_metric";

  // Broad, dataset-specific financial questions are safer through the analyst than a guessed metric answer.
  if (financialTopicPattern.test(normalized) && analyticalQuestionPattern.test(normalized)) return "interpretive_financial";
  return "unsupported_general";
}

export function isInterpretiveQuestion(question: string): boolean {
  const intent = classifyFinancialQuestion(question);
  return intent === "interpretive_financial" || intent === "recommendation_investigation";
}

export async function routeFinancialQuestion(
  question: string,
  dataset: FinancialDataset | null,
  requestAnalyst: AnalystRequestHandler,
): Promise<ChatRoutingResult> {
  const intent = classifyFinancialQuestion(question, dataset);
  if (!dataset) return { route: "local", intent, text: answerFinancialQuestion(question, dataset) };

  if (intent === "deterministic_metric" || intent === "category_ranking" || intent === "category_metric") {
    return { route: "local", intent, text: answerFinancialQuestion(question, dataset) };
  }
  if (intent === "unsupported_general") return { route: "local", intent, text: unsupportedResponse };

  const context = prioritizeContextFacts(createFinancialContext(dataset), question);
  if (context.facts.length === 0) {
    return { route: "local", intent, text: "The available financial data is insufficient to support a grounded analysis. Check the source columns and currency, or upload a clearer dataset." };
  }
  if (intent === "recommendation_investigation" && context.categories.length === 0) {
    return { route: "local", intent, text: "The available data does not contain safely analyzed expense categories to support an investigation recommendation." };
  }
  const interpretation = await requestAnalyst({ question, context });
  const facts = interpretation.factRefs.flatMap((id) => {
    const fact = context.facts.find((candidate) => candidate.id === id);
    return fact ? [{ label: fact.label, value: fact.value, unit: fact.unit }] : [];
  });
  return { route: "analyst", intent, interpretation, facts };
}

export function answerFinancialQuestion(question: string, dataset: FinancialDataset | null): string {
  if (!dataset) return "Upload and analyze a financial file first. I can then answer using the figures in that dataset.";
  const normalized = normalizeQuestion(question);
  const { summary } = dataset;
  const caveat = summary.rowsSkipped > 0 ? ` Based on ${summary.rowsAnalyzed} analyzed rows; ${summary.rowsSkipped} rows were skipped.` : "";
  const arabicMetric = getArabicDirectMetric(question);
  if (arabicMetric === "profit") return summary.profit === null ? "Profit is unavailable because both revenue and expense totals are required." : `Analyzed profit is ${formatFinancialAmount(summary.profit, dataset.currency)} (revenue minus expenses).${caveat}`;
  if (arabicMetric === "revenue") return summary.revenue === null ? "Revenue is unavailable because no safe revenue mapping was found." : `Total analyzed revenue is ${formatFinancialAmount(summary.revenue, dataset.currency)}.${caveat}`;
  if (arabicMetric === "expenses") return summary.expenses === null ? "Expenses are unavailable because no safe expense mapping was found." : `Total analyzed expenses are ${formatFinancialAmount(summary.expenses, dataset.currency)}.${caveat}`;
  const rankedCategories = categoryValues(dataset);
  if (categoryRankingPattern.test(normalized)) {
    const highest = rankedCategories[0];
    return highest ? `Highest expense category is ${highest.label} (${formatFinancialAmount(highest.expenses, dataset.currency)}).${caveat}` : "No expense category has a safely analyzed amount in this dataset.";
  }
  const mentionedCategory = findCategoryMention(normalized, dataset);
  if (mentionedCategory && directCategoryAmountPattern.test(normalized)) {
    const category = rankedCategories.find((item) => normalizeQuestion(item.label) === normalizeQuestion(mentionedCategory));
    return category ? `${category.label} expenses are ${formatFinancialAmount(category.expenses, dataset.currency)}.${caveat}` : `No safely analyzed expense was found for ${mentionedCategory}.`;
  }
  if (/(expense ratio|expense percentage|نسبه\s*المصروف)/i.test(normalized)) {
    if (summary.expenseRatio === null) return "Expense ratio is unavailable because safely calculated revenue and expenses are both required.";
    return `Expense ratio is ${summary.expenseRatio.toFixed(1)}%.${caveat}`;
  }
  if (/(revenue|income|ايراد|ايرادات|دخل)/i.test(normalized)) return summary.revenue === null ? "Revenue is unavailable because no safe revenue mapping was found." : `Total analyzed revenue is ${formatFinancialAmount(summary.revenue, dataset.currency)}.${caveat}`;
  if (/(expenses?|spending total|costs?|مصروف|مصاريف|نفقات|انفاق)/i.test(normalized)) return summary.expenses === null ? "Expenses are unavailable because no safe expense mapping was found." : `Total analyzed expenses are ${formatFinancialAmount(summary.expenses, dataset.currency)}.${caveat}`;
  if (/(profit|net result|ربح)/i.test(normalized)) return summary.profit === null ? "Profit is unavailable because both revenue and expense totals are required." : `Analyzed profit is ${formatFinancialAmount(summary.profit, dataset.currency)} (revenue minus expenses).${caveat}`;
  return unsupportedResponse;
}
