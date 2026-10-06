import type { Insight } from "@/lib/financial/types";

type InsightsPanelProps = {
  insights: Insight[];
  revenue: number | null;
  expenses: number | null;
  profit: number | null;
};

export default function InsightsPanel({ insights, revenue, expenses, profit }: InsightsPanelProps) {
  const expenseRatio = revenue !== null && revenue > 0 && expenses !== null ? (expenses / revenue) * 100 : 0;
  const profitMargin = revenue !== null && revenue > 0 && profit !== null ? (profit / revenue) * 100 : 0;
  let recommendation = "Continue monitoring the financial data in this upload.";
  if (profit === null || revenue === null || expenses === null) recommendation = "Some totals are unavailable because the file does not contain enough safe financial mappings.";
  else if (profit < 0) recommendation = "The analyzed expenses exceed analyzed revenue. Review the source rows and major costs.";
  else if (expenseRatio > 80) recommendation = "Analyzed expenses exceed 80% of revenue. Review the source rows and operating costs.";
  else if (revenue > 0 && profitMargin < 15) recommendation = "The measured profit margin is low. Review pricing and cost efficiency.";
  else if (revenue > 0 && profitMargin >= 40) recommendation = "The measured profit margin is strong. Continue monitoring future results.";

  const healthStatus = profit === null || expenses === null || revenue === null ? "Incomplete data" : profit < 0 ? "Critical" : revenue === 0 ? "Insufficient revenue data" : profitMargin < 15 || expenseRatio > 80 ? "Warning" : "Healthy";
  const healthStyle = profit === null || expenses === null || revenue === null
    ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
    : profit < 0
    ? "bg-red-500/10 text-red-400 border-red-500/30"
    : revenue === 0 || profitMargin < 15 || expenseRatio > 80
      ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
      : "bg-green-500/10 text-green-400 border-green-500/30";

  return (
    <section className="mt-8 rounded-xl border border-zinc-700 bg-zinc-900 p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Calculated Financial Insights</h2>
          <p className="mt-1 text-zinc-400">Deterministic observations from safely analyzed rows; no AI service is connected.</p>
        <div className={`mt-4 inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold ${healthStyle}`}>Financial Health: {healthStatus}</div>
      </div>
      <div className="space-y-4">
        {insights.map((insight, index) => (
          <div key={insight.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
            <p className="mb-2 text-sm text-zinc-500">Observation #{index + 1}</p>
            <p className="text-lg text-green-400">{insight.message}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        <p className={`font-semibold ${profit !== null && profit < 0 ? "text-red-400" : profitMargin < 15 ? "text-yellow-400" : "text-green-400"}`}>Recommendation</p>
        <p className="mt-2 text-zinc-300">{recommendation}</p>
      </div>
    </section>
  );
}
