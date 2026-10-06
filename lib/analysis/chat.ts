import type { FinancialDataset } from "@/lib/financial/types";
import { formatFinancialAmount } from "@/lib/financial/unit";

export function isInterpretiveQuestion(question: string): boolean {
  return /\b(why|unusual|investigate|compare|explain|summari[sz]e|trend|decrease|increased|health)\b|\u0644\u0645\u0627\u0630\u0627|\u0642\u0627\u0631\u0646|\u0627\u0634\u0631\u062d|\u0644\u062e\u0635|\u0627\u0646\u062e\u0641\u0636|\u063a\u064a\u0631\u0020\u0639\u0627\u062f\u064a/u.test(question);
}

export function answerFinancialQuestion(question: string, dataset: FinancialDataset | null): string {
  if (!dataset) return "Upload and analyze a financial file first. I can then answer using the figures in that dataset.";
  const normalized = question.toLocaleLowerCase();
  const { summary } = dataset;
  const caveat = summary.rowsSkipped > 0 ? ` Based on ${summary.rowsAnalyzed} analyzed rows; ${summary.rowsSkipped} rows were skipped.` : "";
  if (/(expense ratio|expense percentage|\u0646\u0633\u0628\u0629\s*\u0627\u0644?\u0645\u0635\u0631\u0648\u0641)/i.test(normalized)) {
    if (summary.expenseRatio === null) return "Expense ratio is unavailable because safely calculated revenue and expenses are both required.";
    return `Expense ratio is ${summary.expenseRatio.toFixed(1)}%.${caveat}`;
  }
  if (/(highest expenses|top expenses|expense categor|highest cost|\u0623\u0639\u0644\u0649\s*\u0627\u0644?\u0645\u0635\u0631\u0648\u0641)/i.test(normalized)) {
    const totals = new Map<string, number>();
    for (const row of dataset.rows) {
      if (!row.analyzed || row.expense <= 0) continue;
      const category = row.category || "Uncategorized";
      totals.set(category, (totals.get(category) ?? 0) + row.expense);
    }
    const highest = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return highest.length ? `Highest analyzed expense categories: ${highest.map(([category, total]) => `${category} (${formatFinancialAmount(total, dataset.currency)})`).join(", ")}.${caveat}` : "No expense categories with safely analyzed amounts were found.";
  }
  if ((/(total revenue|revenue|income)/i.test(normalized) || /\u0625\u064a\u0631\u0627\u062f|\u062f\u062e\u0644/u.test(normalized))) return summary.revenue === null ? "Revenue is unavailable because no safe revenue mapping was found." : `Total analyzed revenue is ${formatFinancialAmount(summary.revenue, dataset.currency)}.${caveat}`;
  if ((/(total expenses|expenses|expense|costs)/i.test(normalized) || /\u0645\u0635\u0631\u0648\u0641|\u0646\u0641\u0642\u0627\u062a/u.test(normalized))) return summary.expenses === null ? "Expenses are unavailable because no safe expense mapping was found." : `Total analyzed expenses are ${formatFinancialAmount(summary.expenses, dataset.currency)}.${caveat}`;
  if ((/(profit|net result)/i.test(normalized) || /\u0631\u0628\u062d/u.test(normalized))) return summary.profit === null ? "Profit is unavailable because both revenue and expense totals are required." : `Analyzed profit is ${formatFinancialAmount(summary.profit, dataset.currency)} (revenue minus expenses).${caveat}`;
  return "I can answer questions about total revenue, total expenses, profit, expense ratio, or the highest expense categories in the current dataset.";
}
