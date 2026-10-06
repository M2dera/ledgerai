import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { analyzeData, createUploadedFile, parseFinancialNumber } from "@/lib/analysis/analyzer";
import { answerFinancialQuestion } from "@/lib/analysis/chat";
import { readExcel } from "@/lib/excel/reader";
import type { UploadedFile } from "@/lib/financial/types";
import { deserializeFinancialDataset } from "@/lib/store/financialStore";

function createFile(contents: string, name = "finance.csv"): File {
  return new File([contents], name, { type: name.endsWith(".csv") ? "text/csv" : "application/octet-stream" });
}

async function analyzeCsv(contents: string, name?: string) {
  const file = createFile(contents, name);
  const ingestion = await readExcel(file);
  return { file, ingestion, dataset: analyzeData(ingestion, createUploadedFile(file)) };
}

const uploadedFile: UploadedFile = { id: "test", name: "test.csv", size: 10, type: "text/csv", uploadedAt: new Date(0).toISOString() };

describe("financial ingestion and analysis", () => {
  it("analyzes common English financial columns and ignores empty rows", async () => {
    const result = await analyzeCsv("Date,Category,Description,Amount\n2025-01-01,Revenue,Sale,1200\n2025-01-02,Expense,Rent,300\n,,,\n");
    expect(result.ingestion.errors).toEqual([]);
    expect(result.dataset.summary).toMatchObject({ totalRows: 2, rowsAnalyzed: 2, rowsSkipped: 0, revenue: 1200, expenses: 300, profit: 900 });
  });

  it("reads XLSX and XLS workbooks and treats blank paired values as zero", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Revenue", "Expenses"], [100, null], [null, 25],
    ]), "Transactions");
    for (const bookType of ["xlsx", "xls"] as const) {
      const bytes = XLSX.write(workbook, { bookType, type: "array" });
      const file = new File([new Uint8Array(bytes)], `financial.${bookType}`);
      const dataset = analyzeData(await readExcel(file), createUploadedFile(file));
      expect(dataset.summary).toMatchObject({ revenue: 100, expenses: 25, profit: 75, rowsAnalyzed: 2 });
    }
  });

  it("recognizes Arabic headers, categories, and Arabic numerals", async () => {
    const result = await analyzeCsv("التاريخ,التصنيف,المبلغ\n٢٠٢٥-٠١-٠١,إيرادات,١٥٠٠\n٢٠٢٥-٠١-٠٢,مصروفات,٤٠٠\n");
    expect(result.dataset.summary).toMatchObject({ revenue: 1500, expenses: 400, profit: 1100 });
  });

  it("reports missing amount or financial columns as a validation error", async () => {
    const result = await analyzeCsv("Date,Category,Description\n2025-01-01,Revenue,Sale\n");
    expect(result.ingestion.errors.length).toBeGreaterThan(0);
    expect(result.dataset.errors.length).toBeGreaterThan(0);
  });

  it("treats negative expense amounts by absolute value", async () => {
    const result = await analyzeCsv("Category,Amount\nExpense,-75\nRevenue,200\n");
    expect(result.dataset.summary).toMatchObject({ revenue: 200, expenses: 75, profit: 125 });
    expect(parseFinancialNumber("(1,250.50)")).toBe(-1250.5);
  });

  it("uses debit and credit only when row classification is clear", async () => {
    const file = createFile("Category,Debit,Credit\nRent,80,\nSales,,250\n");
    const dataset = analyzeData(await readExcel(file), createUploadedFile(file));
    expect(dataset.summary).toMatchObject({ revenue: 250, expenses: 80, profit: 170 });

    const ambiguousFile = createFile("Debit,Credit\n80,\n,250\n");
    const ambiguousDataset = analyzeData(await readExcel(ambiguousFile), createUploadedFile(ambiguousFile));
    expect(ambiguousDataset.summary.revenue).toBeNull();
    expect(ambiguousDataset.summary.expenses).toBeNull();
    expect(ambiguousDataset.warnings.join(" ")).toContain("do not identify revenue versus expense");
  });

  it("does not invent missing totals when only one financial side is mapped", async () => {
    const file = createFile("Revenue\n100\n200\n");
    const dataset = analyzeData(await readExcel(file), uploadedFile);
    expect(dataset.summary.revenue).toBe(300);
    expect(dataset.summary.expenses).toBeNull();
    expect(dataset.summary.profit).toBeNull();
  });

  it("does not classify an unlabelled positive amount as revenue", async () => {
    const result = await analyzeCsv("Description,Amount\nOffice payment,200\n");
    expect(result.dataset.summary).toMatchObject({ revenue: 0, expenses: 0, rowsAnalyzed: 0, rowsSkipped: 1, quality: "low" });
    expect(result.dataset.warnings.join(" ")).toContain("excluded from totals");
  });

  it("reports ambiguous amount columns instead of choosing one", async () => {
    const result = await analyzeCsv("Category,Amount,Value\nRevenue,100,100\n");
    expect(result.dataset.errors.join(" ")).toContain("No safe financial amount mapping");
    expect(result.dataset.warnings.join(" ")).toContain("Several columns could represent amount");
  });

  it("returns a structured error for malformed XLSX input", async () => {
    const result = await readExcel(createFile("this is not a workbook", "broken.xlsx"));
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns a structured error for malformed CSV without a financial header", async () => {
    const result = await readExcel(createFile("this is not a financial table\njust some text\n", "broken.csv"));
    expect(result.errors.join(" ")).toContain("header row");
  });

  it("rejects unsupported and empty files", async () => {
    const unsupported = await readExcel(createFile("content", "finance.pdf"));
    const empty = await readExcel(createFile("", "empty.csv"));
    expect(unsupported.errors[0]).toContain("Unsupported file type");
    expect(empty.errors[0]).toContain("empty");
  });

  it("validates and reports corrupt or incompatible local storage payloads", () => {
    expect(deserializeFinancialDataset("not-json")).toBeNull();
    expect(deserializeFinancialDataset(JSON.stringify({ version: 0, dataset: {} }))).toBeNull();
    expect(deserializeFinancialDataset(JSON.stringify({ version: 1, dataset: {} }))).toBeNull();
  });

  it("round trips a valid versioned dataset and rejects a tampered summary", async () => {
    const file = createFile("Category,Amount\nRevenue,100\nExpense,25\n");
    const dataset = analyzeData(await readExcel(file), createUploadedFile(file));
    const serialized = JSON.stringify({ version: 1, dataset });
    expect(deserializeFinancialDataset(serialized)).toEqual(dataset);
    const tampered = { version: 1, dataset: { ...dataset, summary: { ...dataset.summary, profit: 999 } } };
    expect(deserializeFinancialDataset(JSON.stringify(tampered))).toBeNull();
  });

  it("answers deterministic questions from actual dataset totals and categories", async () => {
    const file = createFile("Category,Amount\nRevenue,900\nRent,300\nPayroll,150\n");
    const dataset = analyzeData(await readExcel(file), uploadedFile);
    expect(answerFinancialQuestion("What is total revenue?", dataset)).toContain("900 KD");
    expect(answerFinancialQuestion("Which categories have the highest expenses?", dataset)).toContain("Rent (300 KD)");
    expect(answerFinancialQuestion("What is the expense ratio?", dataset)).toContain("50.0%");
  });
});
