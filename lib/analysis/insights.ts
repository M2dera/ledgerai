import type { FinancialSummary, FinancialUnit, Insight } from "@/lib/financial/types";
import { formatFinancialAmount } from "@/lib/financial/unit";

export function generateInsights(data: FinancialSummary, unit: FinancialUnit): Insight[] {
  const insights: Insight[] = [];
  if (data.quality === "low") {
    insights.push({ id: "quality-low", level: "warning", message: "Data quality is low. Review the skipped rows and column mappings before relying on these figures." });
  }
  if (data.revenue === null) {
    insights.push({ id: "revenue-unavailable", level: "warning", message: "Revenue is unavailable because the dataset has no safe revenue mapping." });
    return insights;
  }
  if (data.expenses === null || data.profit === null) {
    insights.push({ id: "incomplete-metrics", level: "warning", message: "Revenue was analyzed, but expenses and profit are unavailable because a required financial column or classification is missing." });
    return insights;
  }
  if (data.revenue === 0) {
    insights.push({ id: "revenue-missing", level: "warning", message: "No revenue was safely detected in the analyzed rows." });
    return insights;
  }

  const expenseRatio = (data.expenses / data.revenue) * 100;
  const profitMargin = (data.profit / data.revenue) * 100;
  insights.push({ id: "profit-total", level: data.profit >= 0 ? "good" : "warning", message: `Net result from analyzed revenue and expenses: ${formatFinancialAmount(data.profit, unit)}.` });
  insights.push({ id: "expense-ratio", level: expenseRatio > 80 ? "warning" : "info", message: `Expense ratio: ${expenseRatio.toFixed(1)}%.` });
  insights.push({ id: "profit-margin", level: profitMargin < 10 ? "warning" : "info", message: `Profit margin: ${profitMargin.toFixed(1)}%.` });
  if (expenseRatio > 80) insights.push({ id: "expenses-high", level: "warning", message: "Expenses are above 80% of revenue." });
  if (profitMargin > 40) insights.push({ id: "health-strong", level: "good", message: "The measured profit margin is above 40%." });
  if (profitMargin < 10) insights.push({ id: "margin-low", level: "warning", message: "The measured profit margin is below 10%." });
  return insights;
}
