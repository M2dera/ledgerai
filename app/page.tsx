"use client";

import { useLedgerData } from "@/components/providers/LedgerProvider";
import AnalysisCard from "@/components/dashboard/AnalysisCard";
import FileUpload from "@/components/upload/FileUpload";

export default function Home() {
  const { dataset } = useLedgerData();

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 py-12">
      <h1 className="text-6xl font-bold mb-6">Ledger<span className="text-green-400">AI</span></h1>
      <p className="text-xl text-gray-300 text-center max-w-2xl mb-8">
        Your financial assistant. Upload a spreadsheet to analyze the data and get consistent results across your dashboard and chat.
      </p>

      <FileUpload />

      {dataset && (
        <section className="mt-12 w-full max-w-5xl" aria-label="Current financial dataset">
          <p className="mb-4 text-sm text-zinc-400">Current dataset: {dataset.uploadedFile.name} · {dataset.summary.quality} quality · {dataset.summary.confidence}% confidence</p>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <AnalysisCard title="Rows analyzed" value={`${dataset.summary.rowsAnalyzed}/${dataset.summary.totalRows}`} />
            <AnalysisCard title="Revenue" value={dataset.summary.revenue === null ? "Unavailable" : `${dataset.summary.revenue.toLocaleString()} KD`} status={dataset.summary.revenue !== null && dataset.summary.revenue > 0 ? "success" : "neutral"} />
            <AnalysisCard title="Expenses" value={dataset.summary.expenses === null ? "Unavailable" : `${dataset.summary.expenses.toLocaleString()} KD`} status={dataset.summary.expenses !== null && dataset.summary.expenses > 0 ? "warning" : "neutral"} />
            <AnalysisCard title="Profit" value={dataset.summary.profit === null ? "Unavailable" : `${dataset.summary.profit.toLocaleString()} KD`} status={dataset.summary.profit === null ? "neutral" : dataset.summary.profit >= 0 ? "success" : "danger"} />
          </div>
        </section>
      )}

      <div className="mt-16 grid md:grid-cols-3 gap-6 max-w-5xl">
        <div className="bg-zinc-900 p-6 rounded-xl"><h2 className="text-xl font-bold mb-2">Financial Analysis</h2><p className="text-gray-400">Review totals calculated from safely classified rows.</p></div>
        <div className="bg-zinc-900 p-6 rounded-xl"><h2 className="text-xl font-bold mb-2">Data Quality</h2><p className="text-gray-400">See which rows were analyzed and which need attention.</p></div>
        <div className="bg-zinc-900 p-6 rounded-xl"><h2 className="text-xl font-bold mb-2">Deterministic Answers</h2><p className="text-gray-400">Ask the chat for figures from your uploaded dataset.</p></div>
      </div>
    </main>
  );
}
