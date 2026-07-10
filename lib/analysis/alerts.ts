type AnalysisResult = {
  revenue: number;
  expenses: number;
  profit: number;
};

type SmartAlert = {
  level: "high" | "medium" | "good";
  message: string;
};

export function generateAlerts({
  revenue,
  expenses,
  profit,
}: AnalysisResult): SmartAlert[] {
  const alerts: SmartAlert[] = [];

  const expenseRatio =
    revenue > 0 ? (expenses / revenue) * 100 : 0;

  const profitMargin =
    revenue > 0 ? (profit / revenue) * 100 : 0;

  if (profit < 0) {
    alerts.push({
      level: "high",
      message:
        "Expenses exceed revenue. Immediate cost review is recommended.",
    });
  } else if (expenseRatio > 80) {
    alerts.push({
      level: "high",
      message:
        "Expenses represent more than 80% of revenue.",
    });
  }

  if (profitMargin < 20 && profit >= 0) {
    alerts.push({
      level: "medium",
      message:
        "Profit margin is below 20%. Review pricing and operating costs.",
    });
  }

  if (revenue > expenses && profitMargin >= 20) {
    alerts.push({
      level: "good",
      message:
        "Revenue exceeds expenses and the profit margin is healthy.",
    });
  }

  return alerts.slice(0, 3);
}