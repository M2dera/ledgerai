"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { analyzeData, createUploadedFile } from "@/lib/analysis/analyzer";
import { generateAlerts } from "@/lib/analysis/alerts";
import { generateInsights } from "@/lib/analysis/insights";
import { readExcel } from "@/lib/excel/reader";
import type { Alert, FinancialDataset, Insight, UploadFeedback } from "@/lib/financial/types";
import { loadFinancialDataset, saveFinancialDataset } from "@/lib/store/financialStore";

type LedgerContextValue = {
  dataset: FinancialDataset | null;
  insights: Insight[];
  alerts: Alert[];
  uploadFeedback: UploadFeedback;
  uploadFile: (file: File) => Promise<void>;
};

const LedgerContext = createContext<LedgerContextValue | null>(null);

export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [dataset, setDataset] = useState<FinancialDataset | null>(null);
  const [uploadFeedback, setUploadFeedback] = useState<UploadFeedback>({ status: "idle", message: "", warnings: [], errors: [] });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setDataset((current) => current ?? loadFinancialDataset()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    setUploadFeedback({ status: "loading", message: `Parsing ${file.name}…`, warnings: [], errors: [] });
    try {
      const result = await readExcel(file);
      const nextDataset = analyzeData(result, createUploadedFile(file));
      if (nextDataset.errors.length) {
        setUploadFeedback({ status: "error", message: nextDataset.errors[0], errors: nextDataset.errors, warnings: nextDataset.warnings });
        return;
      }

      setDataset(nextDataset);
      const saved = saveFinancialDataset(nextDataset);
      const partial = nextDataset.summary.rowsSkipped > 0 || nextDataset.summary.quality !== "high" || nextDataset.warnings.length > 0;
      const message = partial
        ? `Partially analyzed ${nextDataset.summary.rowsAnalyzed} of ${nextDataset.summary.totalRows} rows. Review the warnings before relying on these totals.`
        : `Successfully analyzed ${nextDataset.summary.rowsAnalyzed} rows from ${file.name}.`;
      setUploadFeedback({
        status: "success",
        message: saved ? message : `${message} This browser could not save the dataset for the next visit.`,
        warnings: nextDataset.warnings,
        errors: [],
      });
    } catch {
      setUploadFeedback({ status: "error", message: "The file could not be parsed. Check that it is a valid XLSX, XLS, or CSV file.", warnings: [], errors: ["The file could not be parsed. Check that it is a valid XLSX, XLS, or CSV file."] });
    }
  }, []);

  const insights = useMemo(() => dataset ? generateInsights(dataset.summary, dataset.currency) : [], [dataset]);
  const alerts = useMemo(() => dataset ? generateAlerts(dataset.summary) : [], [dataset]);
  const value = useMemo(() => ({ dataset, insights, alerts, uploadFeedback, uploadFile }), [dataset, insights, alerts, uploadFeedback, uploadFile]);

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedgerData(): LedgerContextValue {
  const context = useContext(LedgerContext);
  if (!context) throw new Error("useLedgerData must be used within LedgerProvider.");
  return context;
}
