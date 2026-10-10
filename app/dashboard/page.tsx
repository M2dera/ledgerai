"use client";

import Link from "next/link";
import Sidebar from "@/components/layout/Sidebar";
import FileUpload from "@/components/upload/FileUpload";
import AnalysisCard from "@/components/dashboard/AnalysisCard";
import AccountingOverview from "@/components/dashboard/AccountingOverview";
import AccountingNextActions from "@/components/dashboard/AccountingNextActions";
import PageHeader from "@/components/common/PageHeader";
import InsightsPanel from "@/components/dashboard/InsightsPanel";
import FinancialChart from "@/components/charts/FinancialChart";
import FinancialRatios from "@/components/dashboard/FinancialRatios";
import TimeSavedCard from "@/components/dashboard/TimeSavedCard";
import SmartAlerts from "@/components/dashboard/SmartAlerts";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import { useAccountingSession } from "@/components/providers/AccountingSessionProvider";

export default function DashboardPage() {
  const { dataset, insights, alerts, isReady } = useLedgerData();
  const { chat } = useAccountingSession();
  const summary = dataset?.summary;

  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />
      <main className="flex-1 p-10">
        <div className="max-w-6xl">
          <PageHeader title="Dashboard" subtitle="Review posted accounting performance and your uploaded spreadsheet analysis." />
          {dataset && <FileUpload />}

          <AccountingOverview ledger={chat.ledger} />
          <AccountingNextActions
            ledger={chat.ledger}
            transactions={chat.messages.flatMap((message) => message.sender === "ai" && message.transaction ? [message.transaction] : [])}
          />

          <section className="mt-8" aria-labelledby="uploaded-analysis-title">
            <h2 id="uploaded-analysis-title" className="text-xl font-semibold">Uploaded spreadsheet analysis</h2>
            <p className="mt-2 text-sm text-zinc-400">Source: Uploaded spreadsheet. Charts, ratios, alerts, and insights use analyzed upload rows.</p>

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
                <div className="mt-6 max-w-sm">
                  <AnalysisCard title="Rows analyzed" value={`${summary.rowsAnalyzed}/${summary.totalRows}`} />
                </div>
                {alerts.length > 0 && <SmartAlerts alerts={alerts} />}
                {summary.revenue !== null && summary.expenses !== null && summary.profit !== null && <FinancialChart revenue={summary.revenue} expenses={summary.expenses} profit={summary.profit} unit={dataset.currency} />}
                {summary.revenue !== null && summary.expenses !== null && summary.profit !== null && <FinancialRatios revenue={summary.revenue} expenses={summary.expenses} profit={summary.profit} />}
                <TimeSavedCard rows={summary.rowsAnalyzed} />
                {insights.length > 0 && <InsightsPanel insights={insights} revenue={summary.revenue} expenses={summary.expenses} profit={summary.profit} />}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
