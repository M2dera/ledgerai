import { FinancialAnalysis } from "./analyzer";

export function generateInsights(data: FinancialAnalysis): string[] {
  const insights: string[] = [];

  if (data.revenue === 0) {
    insights.push("No revenue data detected.");
    return insights;
  }

  const expenseRatio = (data.expenses / data.revenue) * 100;
  const profitMargin = (data.profit / data.revenue) * 100;

  insights.push(
    `Revenue exceeds expenses by ${data.profit.toLocaleString()} KD.`
  );

  insights.push(
    `Expense Ratio: ${expenseRatio.toFixed(1)}%`
  );

  insights.push(
    `Profit Margin: ${profitMargin.toFixed(1)}%`
  );

  if (expenseRatio > 80) {
    insights.push(
      "Expenses are unusually high."
    );
  }

  if (profitMargin > 40) {
    insights.push(
      "Overall financial health is strong."
    );
  }

  if (profitMargin < 10) {
    insights.push(
      "Profit margin is critically low."
    );
  }

  return insights;
}