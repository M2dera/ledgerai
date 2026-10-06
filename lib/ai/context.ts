import { aggregateMonthlyPeriods, comparePeriods } from "@/lib/analysis/periods";
import type { FinancialDataset } from "@/lib/financial/types";
import type { FinancialContext, FinancialFact } from "./types";

const MAX_CATEGORIES = 8;
const MAX_PERIODS = 12;
const MAX_FACTS = 64;
const MAX_TRANSACTIONS = 3;

function stableId(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); }
  return `fact-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createFinancialContext(dataset: FinancialDataset, options: { includeTransactions?: boolean } = {}): FinancialContext {
  const facts: FinancialFact[] = [];
  const add = (kind: FinancialFact["kind"], label: string, value: number | null, periodId?: string) => {
    if (value === null || dataset.currency.status === "ambiguous") return;
    facts.push({ id: stableId(`${kind}|${label}|${periodId ?? "all"}`), kind, label, value, unit: dataset.currency, ...(periodId ? { periodId } : {}) });
  };
  add("total", "revenue", dataset.summary.revenue);
  add("total", "expenses", dataset.summary.expenses);
  add("total", "profit", dataset.summary.profit);
  add("ratio", "expense ratio percent", dataset.summary.expenseRatio);
  add("ratio", "profit margin percent", dataset.summary.profitMargin);
  const categoryTotals = new Map<string, number>();
  if (dataset.currency.status !== "ambiguous") for (const row of dataset.rows) {
    if (!row.analyzed || row.expense <= 0) continue;
    const label = (row.category || "Uncategorized").slice(0, 100);
    categoryTotals.set(label, (categoryTotals.get(label) ?? 0) + row.expense);
  }
  const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_CATEGORIES)
    .map(([label, expenses]) => { add("category", label, expenses); return { label: { value: label, trust: "untrusted" as const }, expenses }; });
  const periods = aggregateMonthlyPeriods(dataset).slice(-MAX_PERIODS);
  for (const period of periods) {
    add("period", `${period.id} revenue`, period.revenue, period.id);
    add("period", `${period.id} expenses`, period.expenses, period.id);
    add("period", `${period.id} profit`, period.profit, period.id);
  }
  const comparisons = periods.slice(1).flatMap((period, index) => {
    const comparison = comparePeriods(periods, periods[index].id, period.id);
    if (comparison) {
      add("comparison", `${comparison.earlier.id} to ${comparison.later.id} revenue delta`, comparison.revenueDelta);
      add("comparison", `${comparison.earlier.id} to ${comparison.later.id} expense delta`, comparison.expenseDelta);
      add("comparison", `${comparison.earlier.id} to ${comparison.later.id} profit delta`, comparison.profitDelta);
    }
    return comparison ? [comparison] : [];
  });
  const warnings = dataset.warnings.slice(0, 8).map((warning) => warning.slice(0, 240));
  const transactionDetails = options.includeTransactions && dataset.currency.status !== "ambiguous"
    ? dataset.rows.filter((row) => row.analyzed && row.description).slice(0, MAX_TRANSACTIONS).map((row) => ({
      ...(row.date ? { date: row.date.slice(0, 40) } : {}),
      description: { value: (row.description ?? "").slice(0, 240), trust: "untrusted" as const },
      amount: row.expense > 0 ? row.expense : row.revenue,
    }))
    : [];
  return {
    version: 1, facts: facts.slice(0, MAX_FACTS), categories, periods, comparisons,
    quality: { level: dataset.summary.quality, confidence: dataset.summary.confidence, rowsAnalyzed: dataset.summary.rowsAnalyzed, rowsSkipped: dataset.summary.rowsSkipped, warnings: warnings.map((value) => ({ value, trust: "untrusted" as const })) },
    unit: dataset.currency, transactionDetails,
  };
}
