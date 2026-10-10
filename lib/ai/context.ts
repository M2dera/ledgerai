import { aggregateMonthlyPeriods, comparePeriods } from "@/lib/analysis/periods";
import type { FinancialDataset } from "@/lib/financial/types";
import type { CategoryPeriodChange, FinancialChangeSignal, FinancialContext, FinancialFact, FinancialTrend } from "./types";

const MAX_CATEGORIES = 6;
const MAX_TREND_CATEGORIES = 4;
const MAX_PERIODS = 6;
const MAX_FACTS = 64;
const MAX_TRANSACTIONS = 3;

function stableId(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); }
  return `fact-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function monthId(dateValue: string | undefined): string | null {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function directionOf(deltas: Array<number | null>): FinancialTrend["direction"] {
  const signs = deltas.filter((delta): delta is number => delta !== null).map((delta) => Math.sign(delta));
  if (!signs.length || signs.every((sign) => sign === 0)) return "stable";
  const hasPositive = signs.some((sign) => sign > 0);
  const hasNegative = signs.some((sign) => sign < 0);
  if (hasPositive && hasNegative) return "mixed";
  return hasPositive ? "increasing" : "decreasing";
}

export function createFinancialContext(dataset: FinancialDataset, options: { includeTransactions?: boolean } = {}): FinancialContext {
  const facts: FinancialFact[] = [];
  const add = (kind: FinancialFact["kind"], label: string, value: number | null, periodId?: string, labelTrust: "verified" | "untrusted" = "verified"): string | null => {
    if (value === null || dataset.currency.status === "ambiguous") return null;
    const id = stableId(`${kind}|${label}|${periodId ?? "all"}`);
    const unit = kind === "ratio" ? { kind: "percentage" as const } : { kind: "currency" as const, unit: dataset.currency };
    facts.push({ id, kind, label, labelTrust, value, unit, ...(periodId ? { periodId } : {}) });
    return id;
  };

  add("total", "revenue", dataset.summary.revenue);
  add("total", "expenses", dataset.summary.expenses);
  add("total", "profit", dataset.summary.profit);
  add("ratio", "expense ratio percent", dataset.summary.expenseRatio);
  add("ratio", "profit margin percent", dataset.summary.profitMargin);

  const allCategoryTotals = new Map<string, number>();
  const monthlyCategoryTotals = new Map<string, Map<string, number>>();
  if (dataset.currency.status !== "ambiguous") for (const row of dataset.rows) {
    if (!row.analyzed || row.expense <= 0) continue;
    const label = (row.category || "Uncategorized").trim().slice(0, 100);
    allCategoryTotals.set(label, (allCategoryTotals.get(label) ?? 0) + row.expense);
    const periodId = monthId(row.date);
    if (periodId) {
      const periodTotals = monthlyCategoryTotals.get(periodId) ?? new Map<string, number>();
      periodTotals.set(label, (periodTotals.get(label) ?? 0) + row.expense);
      monthlyCategoryTotals.set(periodId, periodTotals);
    }
  }

  const rankedTotals = [...allCategoryTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_CATEGORIES);
  const categories = rankedTotals.map(([label, expenses], index) => {
    const factId = add("category", label, expenses, undefined, "untrusted");
    const sharePercent = dataset.summary.expenses !== null && dataset.summary.expenses > 0
      ? expenses / dataset.summary.expenses * 100
      : null;
    const shareFactId = sharePercent === null ? null : add("ratio", `${label} expense share percent`, sharePercent, undefined, "untrusted");
    return {
      rank: index + 1,
      label: { value: label, trust: "untrusted" as const },
      expenses,
      sharePercent,
      factId: factId ?? stableId(`category|${label}|all`),
      shareFactId,
    };
  });

  const allPeriods = aggregateMonthlyPeriods(dataset);
  const periods = allPeriods.slice(-MAX_PERIODS);
  for (const period of periods) {
    add("period", `${period.id} revenue`, period.revenue, period.id);
    add("period", `${period.id} expenses`, period.expenses, period.id);
    add("period", `${period.id} profit`, period.profit, period.id);
  }

  const comparisonFactIds = new Map<string, string>();
  const comparisons = periods.slice(1).flatMap((period, index) => {
    const comparison = comparePeriods(periods, periods[index].id, period.id);
    if (!comparison) return [];
    const earlierId = comparison.earlier.id;
    const laterId = comparison.later.id;
    const metrics: Array<["revenue" | "expenses" | "profit", number | null]> = [
      ["revenue", comparison.revenueDelta],
      ["expenses", comparison.expenseDelta],
      ["profit", comparison.profitDelta],
    ];
    for (const [metric, delta] of metrics) {
      const id = add("comparison", `${earlierId} to ${laterId} ${metric} delta`, delta);
      if (id) comparisonFactIds.set(`${earlierId}|${laterId}|${metric}`, id);
    }
    return [comparison];
  });

  const categoryChanges: CategoryPeriodChange[] = [];
  if (periods.length > 1) {
    const earlier = periods[periods.length - 2];
    const later = periods[periods.length - 1];
    for (const [label] of rankedTotals.slice(0, MAX_TREND_CATEGORIES)) {
      const earlierExpenses = monthlyCategoryTotals.get(earlier.id)?.get(label) ?? 0;
      const laterExpenses = monthlyCategoryTotals.get(later.id)?.get(label) ?? 0;
      const earlierFactId = add("period", `${earlier.id} ${label} expenses`, earlierExpenses, earlier.id, "untrusted");
      const laterFactId = add("period", `${later.id} ${label} expenses`, laterExpenses, later.id, "untrusted");
      const delta = laterExpenses - earlierExpenses;
      const deltaFactId = add("comparison", `${earlier.id} to ${later.id} ${label} expense delta`, delta, undefined, "untrusted");
      if (earlierFactId && laterFactId && deltaFactId) categoryChanges.push({
        label: { value: label, trust: "untrusted" },
        earlierPeriod: earlier.id,
        laterPeriod: later.id,
        earlierExpenses,
        laterExpenses,
        delta,
        earlierFactId,
        laterFactId,
        deltaFactId,
      });
    }
  }

  const metricSpecs = [
    ["revenue", "revenueDelta"],
    ["expenses", "expenseDelta"],
    ["profit", "profitDelta"],
  ] as const;
  const trends: FinancialTrend[] = metricSpecs.flatMap(([metric, deltaKey]) => {
    const factRefs = comparisons.flatMap((comparison) => {
      const id = comparisonFactIds.get(`${comparison.earlier.id}|${comparison.later.id}|${metric}`);
      return id ? [id] : [];
    });
    if (!factRefs.length) return [];
    return [{ metric, direction: directionOf(comparisons.map((comparison) => comparison[deltaKey])), periodIds: periods.map((period) => period.id), factRefs }];
  });

  const changeSignals: FinancialChangeSignal[] = [];
  for (const comparison of comparisons) {
    for (const [metric, delta] of [
      ["revenue", comparison.revenueDelta],
      ["expenses", comparison.expenseDelta],
      ["profit", comparison.profitDelta],
    ] as const) {
      const factId = comparisonFactIds.get(`${comparison.earlier.id}|${comparison.later.id}|${metric}`);
      if (factId && delta !== null) changeSignals.push({ label: { value: metric, trust: "verified" }, earlierPeriod: comparison.earlier.id, laterPeriod: comparison.later.id, delta, factId });
    }
  }
  for (const change of categoryChanges) changeSignals.push({
    label: change.label,
    earlierPeriod: change.earlierPeriod,
    laterPeriod: change.laterPeriod,
    delta: change.delta,
    factId: change.deltaFactId,
  });
  const positive = changeSignals.filter((change) => change.delta > 0).sort((a, b) => b.delta - a.delta)[0] ?? null;
  const negative = changeSignals.filter((change) => change.delta < 0).sort((a, b) => a.delta - b.delta)[0] ?? null;

  const warnings = dataset.warnings.slice(0, 8).map((warning) => warning.slice(0, 240));
  if (allPeriods.length > periods.length) warnings.push(`Only the latest ${MAX_PERIODS} valid monthly periods are included in the analyst context.`);
  if (allCategoryTotals.size > categories.length) warnings.push(`Only the top ${MAX_CATEGORIES} expense categories are included in the analyst context.`);
  const transactionDetails = options.includeTransactions && dataset.currency.status !== "ambiguous"
    ? dataset.rows.filter((row) => row.analyzed && row.description).slice(0, MAX_TRANSACTIONS).map((row) => ({
      ...(row.date ? { date: row.date.slice(0, 40) } : {}),
      description: { value: (row.description ?? "").slice(0, 240), trust: "untrusted" as const },
      amount: row.expense > 0 ? row.expense : row.revenue,
    }))
    : [];

  return {
    version: 3,
    facts: facts.slice(0, MAX_FACTS),
    categories,
    periods,
    comparisons,
    categoryChanges,
    trends,
    largestChanges: { positive, negative },
    quality: {
      level: dataset.summary.quality,
      confidence: dataset.summary.confidence,
      rowsAnalyzed: dataset.summary.rowsAnalyzed,
      rowsSkipped: dataset.summary.rowsSkipped,
      warnings: warnings.slice(0, 8).map((value) => ({ value, trust: "untrusted" as const })),
    },
    unit: dataset.currency,
    transactionDetails,
  };
}
