"use client";
export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      
      <h1 className="text-6xl font-bold mb-6">
        Ledger<span className="text-green-400">AI</span>
      </h1>

      <p className="text-xl text-gray-300 text-center max-w-2xl mb-8">
        Your AI-powered financial assistant.
        Analyze your business data, discover insights,
        and make smarter decisions in seconds.
      </p>

      <label className="bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-4 rounded-xl text-lg cursor-pointer">
  Upload Financial File
  <input
    type="file"
    accept=".xlsx,.xls,.csv"
    className="hidden"
    onChange={(e) => {
      const file = e.target.files?.[0];
      if (file) {
        alert(`Selected file: ${file.name}`);
      }
    }}
  />
</label>

      <div className="mt-16 grid md:grid-cols-3 gap-6 max-w-5xl">
        
        <div className="bg-zinc-900 p-6 rounded-xl">
          <h2 className="text-xl font-bold mb-2">
            AI Analysis
          </h2>
          <p className="text-gray-400">
            Understand your numbers automatically.
          </p>
        </div>

        <div className="bg-zinc-900 p-6 rounded-xl">
          <h2 className="text-xl font-bold mb-2">
            Smart Reports
          </h2>
          <p className="text-gray-400">
            Generate professional financial reports.
          </p>
        </div>

        <div className="bg-zinc-900 p-6 rounded-xl">
          <h2 className="text-xl font-bold mb-2">
            Better Decisions
          </h2>
          <p className="text-gray-400">
            Turn data into business insights.
          </p>
        </div>

      </div>

    </main>
  );
}
