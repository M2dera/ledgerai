"use client";

import Link from "next/link";
import Sidebar from "@/components/layout/Sidebar";
import FileUpload from "@/components/upload/FileUpload";
import AnalysisCard from "@/components/dashboard/AnalysisCard";
import PageHeader from "@/components/common/PageHeader";
import InsightsPanel from "@/components/dashboard/InsightsPanel";
import FinancialChart from "@/components/charts/FinancialChart";
import FinancialRatios from "@/components/dashboard/FinancialRatios";
import TimeSavedCard from "@/components/dashboard/TimeSavedCard";
import SmartAlerts from "@/components/dashboard/SmartAlerts";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import { formatFinancialAmount } from "@/lib/financial/unit";

export default function DashboardPage() {
  const { dataset, insights, alerts, isReady } = useLedgerData();
  const summary = dataset?.summary;

  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />
      <main className="flex-1 p-10">
        <div className="max-w-6xl">
          <PageHeader title="Dashboard" subtitle="Upload a financial file and review the figures that can be safely interpreted." />
          {dataset && <FileUpload />}

          {!dataset && !isReady && <p className="mt-8 text-zinc-400" role="status">Restoring the latest saved dataset…</p>}
          {!dataset && isReady && <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-8" aria-labelledby="empty-dashboard-title">
            <h2 id="empty-dashboard-title" className="text-2xl font-bold">No financial dataset yet</h2>
            <p className="mt-2 text-zinc-400">Upload a financial file to see your analysis, insights, and alerts here.</p>
            <Link href="/" className="mt-5 inline-flex rounded-xl bg-green-500 px-5 py-3 font-semibold text-black hover:bg-green-600">Upload a financial file</Link>
          </section>}
          {dataset && summary && (
            <>
              <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
                <p><span className="font-semibold text-white">{dataset.uploadedFile.name}</span> · {summary.rowsAnalyzed} rows analyzed, {summary.rowsSkipped} skipped · {summary.quality} interpretation quality ({summary.confidence}% confidence)</p>
                <p className="mt-2">Detected columns: {Object.entries(dataset.detectedColumns).map(([field, column]) => `${field}: ${column}`).join(" · ") || "none"}</p>
                <p className="mt-2">Financial totals include analyzed rows only. Review warnings before relying on partial results.</p>
                {dataset.warnings.length > 0 && <ul className="mt-2 list-inside list-disc text-yellow-300">{dataset.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
              </div>
              <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
                <AnalysisCard title="Rows analyzed" value={`${summary.rowsAnalyzed}/${summary.totalRows}`} />
                <AnalysisCard title="Revenue" value={summary.revenue === null ? "Unavailable" : formatFinancialAmount(summary.revenue, dataset.currency)} status={summary.revenue !== null && summary.revenue > 0 ? "success" : "neutral"} />
                <AnalysisCard title="Expenses" value={summary.expenses === null ? "Unavailable" : formatFinancialAmount(summary.expenses, dataset.currency)} status={summary.expenses !== null && summary.expenses > 0 ? "warning" : "neutral"} />
                <AnalysisCard title="Profit" value={summary.profit === null ? "Unavailable" : formatFinancialAmount(summary.profit, dataset.currency)} status={summary.profit === null ? "neutral" : summary.profit >= 0 ? "success" : "danger"} />
              </div>
              <div className="mt-6">
                <Link href="/chat" className="inline-flex rounded-xl border border-green-500/50 px-5 py-3 font-semibold text-green-300 hover:bg-green-500/10">Open AI Analyst</Link>
              </div>
              {alerts.length > 0 && <SmartAlerts alerts={alerts} />}
              {summary.revenue !== null && summary.expenses !== null && summary.profit !== null && <FinancialChart revenue={summary.revenue} expenses={summary.expenses} profit={summary.profit} unit={dataset.currency} />}
              {summary.revenue !== null && summary.expenses !== null && summary.profit !== null && <FinancialRatios revenue={summary.revenue} expenses={summary.expenses} profit={summary.profit} />}
              <TimeSavedCard rows={summary.rowsAnalyzed} />
              {insights.length > 0 && <InsightsPanel insights={insights} revenue={summary.revenue} expenses={summary.expenses} profit={summary.profit} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
