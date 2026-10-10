import type { FinancialDataset, FinancialPeriod, PeriodComparison } from "@/lib/financial/types";

export function aggregateMonthlyPeriods(dataset: FinancialDataset): FinancialPeriod[] {
  const grouped = new Map<string, { revenue: number; expenses: number; rows: number }>();
  for (const row of dataset.rows) {
    if (!row.analyzed || !row.date) continue;
    const date = new Date(row.date);
    if (!Number.isFinite(date.getTime())) continue;
    const id = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const current = grouped.get(id) ?? { revenue: 0, expenses: 0, rows: 0 };
    current.revenue += row.revenue;
    current.expenses += row.expense;
    current.rows += 1;
    grouped.set(id, current);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, item]) => {
    const [year, month] = id.split("-").map(Number);
    return {
      id, label: id, year, month,
      revenue: dataset.summary.revenue === null ? null : item.revenue,
      expenses: dataset.summary.expenses === null ? null : item.expenses,
      profit: dataset.summary.profit === null ? null : item.revenue - item.expenses,
      rowsAnalyzed: item.rows,
    };
  });
}

function change(later: number | null, earlier: number | null): number | null {
  return later === null || earlier === null ? null : later - earlier;
}
function percent(delta: number | null, earlier: number | null): number | null {
  return delta === null || earlier === null || earlier === 0 ? null : delta / Math.abs(earlier) * 100;
}

export function comparePeriods(periods: FinancialPeriod[], earlierId: string, laterId: string): PeriodComparison | null {
  const earlier = periods.find((period) => period.id === earlierId);
  const later = periods.find((period) => period.id === laterId);
  if (!earlier || !later || earlier.id === later.id || earlier.rowsAnalyzed === 0 || later.rowsAnalyzed === 0) return null;
  const revenueDelta = change(later.revenue, earlier.revenue);
  const expenseDelta = change(later.expenses, earlier.expenses);
  const profitDelta = change(later.profit, earlier.profit);
  return {
    earlier, later, revenueDelta, expenseDelta, profitDelta,
    revenuePercentChange: percent(revenueDelta, earlier.revenue),
    expensePercentChange: percent(expenseDelta, earlier.expenses),
    profitPercentChange: percent(profitDelta, earlier.profit),
  };
}
