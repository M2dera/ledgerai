"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import AnalysisCard from "@/components/dashboard/AnalysisCard";
import Sidebar from "@/components/layout/Sidebar";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import FileUpload from "@/components/upload/FileUpload";
import { formatFinancialAmount } from "@/lib/financial/unit";

export default function Home() {
  const { dataset, isReady } = useLedgerData();
  const router = useRouter();

  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />
      <main className="flex min-h-screen flex-1 flex-col items-center justify-center px-6 py-12">
        <h1 className="mb-6 text-6xl font-bold">Ledger<span className="text-green-400">AI</span></h1>
        <p className="mb-8 max-w-2xl text-center text-xl text-gray-300">
          Your financial assistant. Upload a spreadsheet to analyze the data and get consistent results across your dashboard and chat.
        </p>

        <FileUpload onSuccess={() => router.push("/dashboard")} />
        {!isReady && <p className="mt-4 text-sm text-zinc-500" role="status">Restoring your saved dataset…</p>}

        {dataset && (
          <section className="mt-12 w-full max-w-5xl" aria-label="Current financial dataset">
            <p className="mb-4 text-sm text-zinc-400">Current dataset: {dataset.uploadedFile.name} · {dataset.summary.quality} quality · {dataset.summary.confidence}% confidence</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <AnalysisCard title="Rows analyzed" value={`${dataset.summary.rowsAnalyzed}/${dataset.summary.totalRows}`} />
              <AnalysisCard title="Revenue" value={dataset.summary.revenue === null ? "Unavailable" : formatFinancialAmount(dataset.summary.revenue, dataset.currency)} status={dataset.summary.revenue !== null && dataset.summary.revenue > 0 ? "success" : "neutral"} />
              <AnalysisCard title="Expenses" value={dataset.summary.expenses === null ? "Unavailable" : formatFinancialAmount(dataset.summary.expenses, dataset.currency)} status={dataset.summary.expenses !== null && dataset.summary.expenses > 0 ? "warning" : "neutral"} />
              <AnalysisCard title="Profit" value={dataset.summary.profit === null ? "Unavailable" : formatFinancialAmount(dataset.summary.profit, dataset.currency)} status={dataset.summary.profit === null ? "neutral" : dataset.summary.profit >= 0 ? "success" : "danger"} />
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/dashboard" className="rounded-xl bg-green-500 px-5 py-3 font-semibold text-black hover:bg-green-600">Open dashboard</Link>
              <Link href="/chat" className="rounded-xl border border-zinc-700 px-5 py-3 font-semibold text-white hover:bg-zinc-900">Open AI Analyst</Link>
            </div>
          </section>
        )}

        <div className="mt-16 grid max-w-5xl gap-6 md:grid-cols-3">
          <div className="rounded-xl bg-zinc-900 p-6"><h2 className="mb-2 text-xl font-bold">Financial Analysis</h2><p className="text-gray-400">Review totals calculated from safely classified rows.</p></div>
          <div className="rounded-xl bg-zinc-900 p-6"><h2 className="mb-2 text-xl font-bold">Data Quality</h2><p className="text-gray-400">See which rows were analyzed and which need attention.</p></div>
          <div className="rounded-xl bg-zinc-900 p-6"><h2 className="mb-2 text-xl font-bold">Deterministic Answers</h2><p className="text-gray-400">Ask the chat for figures from your uploaded dataset.</p></div>
        </div>
      </main>
    </div>
  );
}
