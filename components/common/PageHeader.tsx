export default function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-10">
      <h1 className="text-4xl font-bold text-white">{title}</h1>
      <p className="text-gray-400 mt-2 text-lg">{subtitle}</p>
    </div>
  );
}