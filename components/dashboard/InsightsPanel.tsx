type InsightsPanelProps = {
  insights: string[];
};

export default function InsightsPanel({
  insights,
}: InsightsPanelProps) {
  return (
    <div className="mt-8 rounded-xl border border-zinc-700 bg-zinc-900 p-6">
      <h2 className="text-xl font-bold text-white mb-4">
        🧠 AI Financial Insights
      </h2>

      <div className="space-y-3">
        {insights.map((insight, index) => (
          <div
            key={index}
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-4"
          >
            <p className="text-green-400">
              ✓ {insight}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}