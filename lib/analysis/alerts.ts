import type { Alert, FinancialSummary } from "@/lib/financial/types";

export function generateAlerts(data: FinancialSummary): Alert[] {
  const alerts: Alert[] = [];
  const { revenue, expenses, profit } = data;
  if (revenue === null || expenses === null || profit === null) {
    if (data.quality === "low") alerts.push({ id: "data-quality", level: "medium", message: "Data quality is low. Review warnings and skipped rows; some totals are unavailable." });
    return alerts;
  }
  const expenseRatio = revenue > 0 ? (expenses / revenue) * 100 : 0;
  const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

  if (data.quality === "low") {
    alerts.push({ id: "data-quality", level: "medium", message: "Data quality is low. Review warnings and skipped rows before using these totals." });
  }
  if (profit < 0) {
    alerts.push({ id: "loss", level: "high", message: "Expenses exceed revenue. Review the classified financial rows." });
  } else if (revenue > 0 && expenseRatio > 80) {
    alerts.push({ id: "high-expense-ratio", level: "high", message: "Expenses represent more than 80% of revenue." });
  }
  if (revenue > 0 && profitMargin < 20 && profit >= 0) {
    alerts.push({ id: "low-margin", level: "medium", message: "Profit margin is below 20%. Review pricing and operating costs." });
  }
  if (revenue > 0 && profitMargin >= 20) {
    alerts.push({ id: "healthy-margin", level: "good", message: "The analyzed rows show a profit margin of at least 20%." });
  }
  return alerts.slice(0, 3);
}
