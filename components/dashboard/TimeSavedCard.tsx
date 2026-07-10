type TimeSavedCardProps = {
  rows: number;
};

export default function TimeSavedCard({
  rows,
}: TimeSavedCardProps) {
  const minutesSaved = Math.max(
    5,
    Math.round(rows * 0.35)
  );

  return (
    <div className="mt-8 rounded-xl border border-zinc-700 bg-zinc-900 p-6">

      <p className="text-zinc-400 text-sm">
        ⏳ Estimated Time Saved
      </p>

      <h2 className="mt-2 text-4xl font-bold text-green-400">
        {minutesSaved} min
      </h2>

      <p className="mt-3 text-zinc-500">
        Based on automated financial analysis.
      </p>

    </div>
  );
}