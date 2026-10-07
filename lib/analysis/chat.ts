import type { FinancialDataset, FinancialFactUnit } from "@/lib/financial/types";
import { formatFinancialAmount } from "@/lib/financial/unit";
import { createFinancialContext } from "@/lib/ai/context";
import type { AnalystInterpretation, AnalystRequest } from "@/lib/ai/types";

export type FinancialQuestionIntent =
  | "deterministic_metric"
  | "category_ranking"
  | "interpretive_financial"
  | "recommendation_investigation"
  | "unsupported_general";

export type ChatRoutingResult =
  | { route: "local"; intent: FinancialQuestionIntent; text: string }
  | { route: "analyst"; intent: "interpretive_financial" | "recommendation_investigation"; interpretation: AnalystInterpretation; facts: Array<{ label: string; value: number; unit: FinancialFactUnit }> };

export type AnalystRequestHandler = (request: AnalystRequest) => Promise<AnalystInterpretation>;

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
const interpretivePattern = /\b(why|how come|explain|analy[sz]e|unusual|anomal(?:y|ies)|pattern|compare|comparison|trend|decreas(?:e|ed|ing)|fell|falling|drop(?:ped|ping)?|increas(?:e|ed|ing)|financial health|business health|outlook|problem|issue|wrong|concern|stand out|important change|important observation|insight|what do you think|tell me about)\b|لماذا|ليش|ليه|شلون|شنو.*(?:ملاحظه|تغيير|وضع|صوره)|وين المشكله|غير طبيعي|غير عادي|نازل|منخفض|انخفض|الوضع المالي|الصحه الماليه|ملاحظه|ملاحظات|التغيير الاهم|اهم تغيير|اهم شي|اكثر شي/u;
const implicitDatasetAnalysisPattern = /\b(what stands out|anything unusual|anything abnormal|what changed|key change|main takeaway|what should i review first|what needs attention)\b|هل.*غير\s*(طبيعي|عادي)|شنو.*(?:ملاحظه|تغيير|وضع|صوره)|اهم\s*(ملاحظه|تغيير|شي)|اكثر\s*شي\s*يحتاج\s*انتباه/u;
const directMetricPattern = /\b(total|overall|my|what is|what are|how much|show|give me)?\s*(revenue|income|expenses?|spending total|costs?|profit|net result|expense ratio|expense percentage)\b|\b(expense ratio|profit margin)\b|how much.*\b(revenue|income|expense|spend|cost|profit)\b|كم\s*(اجمالي\s*)?(الايراد|الايرادات|الدخل|المصاريف|مصاريفي|المصروفات|نفقاتي|النفقات|ربحي|الربح)|ما\s*(هو|هي)?\s*(اجمالي\s*)?(الايراد|الايرادات|الدخل|المصاريف|مصاريفي|المصروفات|نفقاتي|النفقات|ربحي|الربح)|نسبه\s*(المصاريف|مصاريفي|الصرف)|كم\s*نسبه/u;
const categoryRankingPattern = /\b(highest|top|largest|most expensive)\b.{0,50}\b(expense|spending|cost|categor(?:y|ies))\b|\b(which|what)\b.{0,60}\b(expense|spending|cost) categor(?:y|ies)\b|\b(which|what)\b.{0,45}\b(categories.*expenses)\b|\bmost\b.{0,30}\b(spent|spending)\b|اعل[يى].{0,20}(فئه|تصنيف|مصاريف|مصروف|نفقات)|اكثر\s*(فئه|تصنيف)\s*(من\s*)?(المصاريف|الصرف|انفاق|مصاريف)|ما\s*هي\s*اعل[يى]\s*الفئات/u;
const financialTopicPattern = /\b(revenue|income|expense|expenses|spending|cost|costs|profit|business|financial|money|cash flow|budget|category|categories)\b|ايراد|ايرادات|دخل|مصروف|مصاريف|نفقات|انفاق|ربح|مالي|ماليه|ميزانيه|سيوله/u;
const analyticalQuestionPattern = /\b(what|why|how|which|where|should|could|tell me|help me|is there|do you)\b|شنو|شو|ايش|كيف|ليش|ليه|وين|هل|وش/u;

export function classifyFinancialQuestion(question: string): FinancialQuestionIntent {
  const normalized = normalizeQuestion(question);
  if (!normalized) return "unsupported_general";

  // Analytical intent wins over metric keywords: "why is profit low?" is not a profit-total request.
  if (recommendationPattern.test(normalized)) return "recommendation_investigation";
  if (interpretivePattern.test(normalized) && (financialTopicPattern.test(normalized) || implicitDatasetAnalysisPattern.test(normalized))) return "interpretive_financial";
  if (categoryRankingPattern.test(normalized)) return "category_ranking";
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
  const intent = classifyFinancialQuestion(question);
  if (!dataset) return { route: "local", intent, text: answerFinancialQuestion(question, dataset) };

  if (intent === "deterministic_metric" || intent === "category_ranking") {
    return { route: "local", intent, text: answerFinancialQuestion(question, dataset) };
  }
  if (intent === "unsupported_general") return { route: "local", intent, text: unsupportedResponse };

  const context = createFinancialContext(dataset);
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
  if (/(expense ratio|expense percentage|نسبه\s*المصروف)/i.test(normalized)) {
    if (summary.expenseRatio === null) return "Expense ratio is unavailable because safely calculated revenue and expenses are both required.";
    return `Expense ratio is ${summary.expenseRatio.toFixed(1)}%.${caveat}`;
  }
  if (categoryRankingPattern.test(normalized)) {
    const totals = new Map<string, number>();
    for (const row of dataset.rows) {
      if (!row.analyzed || row.expense <= 0) continue;
      const category = row.category || "Uncategorized";
      totals.set(category, (totals.get(category) ?? 0) + row.expense);
    }
    const highest = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return highest.length ? `Highest analyzed expense categories: ${highest.map(([category, total]) => `${category} (${formatFinancialAmount(total, dataset.currency)})`).join(", ")}.${caveat}` : "No expense categories with safely analyzed amounts were found.";
  }
  if (/(revenue|income|ايراد|ايرادات|دخل)/i.test(normalized)) return summary.revenue === null ? "Revenue is unavailable because no safe revenue mapping was found." : `Total analyzed revenue is ${formatFinancialAmount(summary.revenue, dataset.currency)}.${caveat}`;
  if (/(expenses?|spending total|costs?|مصروف|مصاريف|نفقات|انفاق)/i.test(normalized)) return summary.expenses === null ? "Expenses are unavailable because no safe expense mapping was found." : `Total analyzed expenses are ${formatFinancialAmount(summary.expenses, dataset.currency)}.${caveat}`;
  if (/(profit|net result|ربح)/i.test(normalized)) return summary.profit === null ? "Profit is unavailable because both revenue and expense totals are required." : `Analyzed profit is ${formatFinancialAmount(summary.profit, dataset.currency)} (revenue minus expenses).${caveat}`;
  return unsupportedResponse;
}
