"use client";

import { useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import FileUpload from "@/components/upload/FileUpload";
import AnalysisCard from "@/components/dashboard/AnalysisCard";
import PageHeader from "@/components/common/PageHeader";
import InsightsPanel from "@/components/dashboard/InsightsPanel";
import { readExcel } from "@/lib/excel/reader";
import { analyzeData } from "@/lib/analysis/analyzer";
import { generateInsights } from "@/lib/analysis/insights";
import FinancialChart from "@/components/charts/FinancialChart";
import FinancialRatios from "@/components/dashboard/FinancialRatios";
import TimeSavedCard from "@/components/dashboard/TimeSavedCard";
import SmartAlerts from "@/components/dashboard/SmartAlerts";
import { generateAlerts } from "@/lib/analysis/alerts";
import { setFinancialData } from "@/lib/store/financialStore";

export default function DashboardPage() {
  const [analysis, setAnalysis] = useState<any>(null);
  const [insights, setInsights] = useState<string[]>([]);
const [alerts, setAlerts] = useState<any[]>([]);

  async function handleFileSelect(file: File) {
    const data = await readExcel(file);
    const result = analyzeData(data);

    setFinancialData(result);
    
    const generatedInsights = generateInsights(result);
    const generatedAlerts = generateAlerts(result);

    console.log("Analysis Result:", result);

    setAnalysis(result);
    setInsights(generatedInsights);
    setAlerts(generatedAlerts);
  }

  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />

      <main className="flex-1 p-10">
        <div className="max-w-6xl">
          <PageHeader
            title="Dashboard"
            subtitle="Upload your financial file and let LedgerAI understand it."
          />

          <FileUpload onFileSelect={handleFileSelect} />

          {analysis && (
            <>
              <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-4">
                <AnalysisCard
                  title="Rows"
                  value={analysis.totalRows}
                />

                <AnalysisCard
                  title="Revenue"
                  value={`${analysis.revenue.toLocaleString()} KD`}
                  status={analysis.revenue > 0 ? "success" : "danger"}
                />

                <AnalysisCard
                  title="Expenses"
                  value={`${analysis.expenses.toLocaleString()} KD`}
                  status={analysis.expenses > 0 ? "success" : "danger"}
                />

                <AnalysisCard
                  title="Profit"
                  value={`${analysis.profit.toLocaleString()} KD`}
                  status={analysis.profit >= 0 ? "success" : "danger"}
                />
              </div>
              {alerts.length > 0 && (
  <SmartAlerts alerts={alerts} />
)}
              <FinancialChart
  revenue={analysis.revenue}
  expenses={analysis.expenses}
  profit={analysis.profit}
/>
<FinancialRatios
  revenue={analysis.revenue}
  expenses={analysis.expenses}
  profit={analysis.profit}
/>
<TimeSavedCard
  rows={analysis.totalRows}
/>
              {insights.length > 0 && (
                <InsightsPanel
                  insights={insights}
                  revenue={analysis.revenue}
                  expenses={analysis.expenses}
                  profit={analysis.profit}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}