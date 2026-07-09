type AnalysisCardProps = {
  title: string;
  value: string | number;
  status?: "success" | "warning" | "danger" | "neutral";
};

export default function AnalysisCard({
  title,
  value,
  status = "neutral",
}: AnalysisCardProps) {
  const statusStyles = {
    success: "border-green-500 text-green-400",
    warning: "border-yellow-500 text-yellow-400",
    danger: "border-red-500 text-red-400",
    neutral: "border-zinc-700 text-white",
  };

  return (
    <div className={`bg-zinc-900 border ${statusStyles[status]} rounded-xl p-6`}>
      <p className="text-sm text-gray-400 mb-2">{title}</p>
      <h3 className="text-3xl font-bold">{value}</h3>
    </div>
  );
}