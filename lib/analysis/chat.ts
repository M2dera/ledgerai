import type { FinancialDataset } from "@/lib/financial/types";

export function answerFinancialQuestion(question: string, dataset: FinancialDataset | null): string {
  if (!dataset) return "Upload and analyze a financial file first. I can then answer using the figures in that dataset.";

  const normalized = question.toLocaleLowerCase();
  const { summary } = dataset;
  const caveat = summary.rowsSkipped > 0 ? ` Based on ${summary.rowsAnalyzed} analyzed rows; ${summary.rowsSkipped} rows were skipped.` : "";
  if (/(expense ratio|نسبة المصروف)/u.test(normalized)) {
    if (summary.expenseRatio === null) return "Expense ratio is unavailable because safely calculated revenue and expenses are both required.";
    return `Expense ratio is ${summary.expenseRatio.toFixed(1)}%.${caveat}`;
  }
  if (/(highest expenses|top expenses|expense categor|highest cost|أعلى المصروف|اعلى المصروف)/u.test(normalized)) {
    const totals = new Map<string, number>();
    for (const row of dataset.rows) {
      if (!row.analyzed || row.expense <= 0) continue;
      const category = row.category || "Uncategorized";
      totals.set(category, (totals.get(category) ?? 0) + row.expense);
    }
    const highest = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return highest.length
      ? `Highest analyzed expense categories: ${highest.map(([category, total]) => `${category} (${total.toLocaleString()} KD)`).join(", ")}.${caveat}`
      : "No expense categories with safely analyzed amounts were found.";
  }
  if (/(total revenue|revenue|income|إيراد|دخل)/u.test(normalized)) return summary.revenue === null ? "Revenue is unavailable because no safe revenue mapping was found." : `Total analyzed revenue is ${summary.revenue.toLocaleString()} KD.${caveat}`;
  if (/(total expenses|expenses|expense|costs|مصروف|نفقات)/u.test(normalized)) return summary.expenses === null ? "Expenses are unavailable because no safe expense mapping was found." : `Total analyzed expenses are ${summary.expenses.toLocaleString()} KD.${caveat}`;
  if (/(profit|net result|ربح)/u.test(normalized)) return summary.profit === null ? "Profit is unavailable because both revenue and expense totals are required." : `Analyzed profit is ${summary.profit.toLocaleString()} KD (revenue minus expenses).${caveat}`;
  return "I can answer questions about total revenue, total expenses, profit, expense ratio, or the highest expense categories in the current dataset.";
}
