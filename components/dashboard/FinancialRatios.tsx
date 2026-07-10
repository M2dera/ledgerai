type FinancialRatiosProps = {
  revenue: number;
  expenses: number;
  profit: number;
};

export default function FinancialRatios({
  revenue,
  expenses,
  profit,
}: FinancialRatiosProps) {
  const profitMargin =
    revenue > 0 ? (profit / revenue) * 100 : 0;

  const expenseRatio =
    revenue > 0 ? (expenses / revenue) * 100 : 0;

  return (
    <div className="mt-8 rounded-xl border border-zinc-700 bg-zinc-900 p-6">
      <h2 className="text-2xl font-bold text-white">
        📊 Financial Ratios
      </h2>

      <p className="mt-1 text-zinc-400">
        Key performance indicators.
      </p>

      {/* Profit Margin */}

      <div className="mt-8">
        <div className="mb-2 flex justify-between">
          <span className="font-medium text-white">
            Profit Margin
          </span>

          <span className="text-green-400 font-bold">
            {profitMargin.toFixed(1)}%
          </span>
        </div>

        <div className="h-4 rounded-full bg-zinc-800">
          <div
            className="h-4 rounded-full bg-green-500 transition-all duration-700"
            style={{
              width: `${Math.min(profitMargin,100)}%`,
            }}
          />
        </div>
      </div>

      {/* Expense Ratio */}

      <div className="mt-8">
        <div className="mb-2 flex justify-between">
          <span className="font-medium text-white">
            Expense Ratio
          </span>

          <span className="text-red-400 font-bold">
            {expenseRatio.toFixed(1)}%
          </span>
        </div>

        <div className="h-4 rounded-full bg-zinc-800">
          <div
            className="h-4 rounded-full bg-red-500 transition-all duration-700"
            style={{
              width: `${Math.min(expenseRatio,100)}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}