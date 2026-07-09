"use client";

import { useState } from "react";
import FileUpload from "../components/upload/FileUpload";
import { readExcel } from "../lib/excel/reader";
import { analyzeData } from "../lib/analysis/analyzer";
import AnalysisCard from "@/components/dashboard/AnalysisCard";
export default function Home() {
  const [analysis, setAnalysis] = useState<any>(null);
 async function handleFileSelect(file: File) {
  const data = await readExcel(file);
  const result = analyzeData(data);

  console.log(result);
  setAnalysis(result);
}

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <h1 className="text-6xl font-bold mb-6">
        Ledger<span className="text-green-400">AI</span>
      </h1>

      <p className="text-xl text-gray-300 text-center max-w-2xl mb-8">
        Your AI-powered financial assistant. Analyze your business data, discover
        insights, and make smarter decisions in seconds.
      </p>

      <FileUpload onFileSelect={handleFileSelect} />
{analysis && (
  <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-5xl">
    <AnalysisCard
      title="Rows"
      value={analysis.totalRows}
    />

    <AnalysisCard
      title="Revenue"
      value={analysis.revenue ? "Found" : "Not Found"}
      status={analysis.revenue ? "success" : "danger"}
    />

    <AnalysisCard
      title="Expenses"
      value={analysis.expenses ? "Found" : "Not Found"}
      status={analysis.expenses ? "success" : "danger"}
    />

    <AnalysisCard
      title="Profit"
      value={analysis.profit ? "Found" : "Not Found"}
      status={analysis.profit ? "success" : "danger"}
    />
  </div>
)}
      <div className="mt-16 grid md:grid-cols-3 gap-6 max-w-5xl">
        <div className="bg-zinc-900 p-6 rounded-xl">
          <h2 className="text-xl font-bold mb-2">AI Analysis</h2>
          <p className="text-gray-400">Understand your numbers automatically.</p>
        </div>

        <div className="bg-zinc-900 p-6 rounded-xl">
          <h2 className="text-xl font-bold mb-2">Smart Reports</h2>
          <p className="text-gray-400">Generate professional financial reports.</p>
        </div>

        <div className="bg-zinc-900 p-6 rounded-xl">
          <h2 className="text-xl font-bold mb-2">Better Decisions</h2>
          <p className="text-gray-400">Turn data into business insights.</p>
        </div>
      </div>
    </main>
  );
}