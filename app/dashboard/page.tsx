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

export default function DashboardPage() {
  const [analysis, setAnalysis] = useState<any>(null);
  const [insights, setInsights] = useState<string[]>([]);

  async function handleFileSelect(file: File) {
    const data = await readExcel(file);
    const result = analyzeData(data);
    const generatedInsights = generateInsights(result);

    console.log("Analysis Result:", result);

    setAnalysis(result);
    setInsights(generatedInsights);
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