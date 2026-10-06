import { detectColumns } from "@/lib/financial/columns";
import { detectFinancialUnit } from "@/lib/financial/unit";
import type {
  DetectedColumns,
  FinancialDataset,
  FinancialQuality,
  FinancialRow,
  FinancialSummary,
  FinancialUnit,
  UploadedFile,
} from "@/lib/financial/types";
import type { IngestionResult } from "@/lib/financial/types";

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .trim();
}

export function parseFinancialNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;

  let normalized = value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/[٬،]/g, ",")
    .replace(/[−–]/g, "-")
    .replace(/\b(KD|KWD|SAR|USD|EUR|ر\.س|د\.ك)\b/gi, "")
    .replace(/\s/g, "")
    .trim();

  let negative = false;
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    negative = true;
    normalized = normalized.slice(1, -1);
  }
  if (normalized.endsWith("-") && !normalized.startsWith("-")) {
    negative = true;
    normalized = normalized.slice(0, -1);
  }
  normalized = normalized.replace(/[^\d.,()+-]/g, "").replace(/,/g, "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function textFrom(row: Record<string, unknown>, column?: string): string | undefined {
  if (!column) return undefined;
  const value = row[column];
  if (value === null || value === undefined || String(value).trim() === "") return undefined;
  return value instanceof Date ? value.toISOString() : String(value).trim();
}

function numberFrom(row: Record<string, unknown>, column?: string): number | null {
  return column ? parseFinancialNumber(row[column]) : null;
}

function categoryDirection(value: string | undefined): "revenue" | "expense" | null {
  const text = normalizeText(value);
  if (/(revenue|sales?|income|إيراد|دخل|مبيعات|بيع)/u.test(text)) return "revenue";
  if (/(expense|cost|spend|rent|payroll|salary|salaries|wages|utilities|marketing|insurance|tax|travel|supplies|مصروف|نفق|تكلف|إيجار|رواتب|أجور)/u.test(text)) return "expense";
  return null;
}

function qualityFor(rowsAnalyzed: number, rowsSkipped: number, warningCount: number, completeMetrics: boolean): { quality: FinancialQuality; confidence: number } {
  const total = rowsAnalyzed + rowsSkipped;
  const analyzedRatio = total ? rowsAnalyzed / total : 0;
  const coverage = completeMetrics ? 1 : 0.65;
  const confidence = Math.round(Math.max(0, Math.min(1, analyzedRatio * coverage * (1 - Math.min(warningCount, 5) * 0.08))) * 100);
  const quality: FinancialQuality = confidence >= 85 ? "high" : confidence >= 55 ? "medium" : "low";
  return { quality, confidence };
}

export function analyzeData(input: IngestionResult, uploadedFile: UploadedFile): FinancialDataset {
  const warnings = [...input.warnings];
  const errors = [...input.errors];
  const detection = detectColumns(input.columns);
  const detectedColumns: DetectedColumns = detection.detected;
  const moneyFields = [detectedColumns.revenue, detectedColumns.expense, detectedColumns.amount, detectedColumns.debit, detectedColumns.credit, detectedColumns.profit].filter((value): value is string => Boolean(value));
  const currency: FinancialUnit = detectFinancialUnit(
    moneyFields,
    input.rows.flatMap((row) => moneyFields.map((field) => row[field])),
  );
  if (currency.status === "unknown") warnings.push("Currency or unit is not stated in the file; totals are shown without an assumed currency.");
  if (currency.status === "ambiguous") warnings.push("Currency or unit markers conflict or are ambiguous; monetary totals are unavailable until the source unit is clarified.");

  for (const [field, columns] of Object.entries(detection.ambiguous)) {
    warnings.push(`Several columns could represent ${field}: ${columns?.join(", ")}. Those values will not be included until the headings are clarified.`);
  }

  const dedicatedFinancialFields = Boolean(detectedColumns.revenue || detectedColumns.expense);
  const debitCreditFields = Boolean(detectedColumns.debit || detectedColumns.credit);
  const amountClassificationAvailable = Boolean(detectedColumns.amount && (detectedColumns.category || detectedColumns.description));
  const amountOnlyAvailable = Boolean(detectedColumns.amount);
  const debitCreditClassificationAvailable = Boolean(debitCreditFields && (detectedColumns.category || detectedColumns.description));
  if (!dedicatedFinancialFields && !debitCreditFields && !amountOnlyAvailable) {
    errors.push("No safe financial amount mapping was found. Use revenue/expense columns, debit/credit columns, or an amount column with category/description values.");
  }

  const revenueAvailable = dedicatedFinancialFields
    ? Boolean(detectedColumns.revenue)
    : debitCreditFields
      ? debitCreditClassificationAvailable
      : amountClassificationAvailable;
  const expensesAvailable = dedicatedFinancialFields
    ? Boolean(detectedColumns.expense)
    : debitCreditFields
      ? debitCreditClassificationAvailable
      : amountClassificationAvailable || (amountOnlyAvailable && input.rows.some((row) => (numberFrom(row, detectedColumns.amount) ?? 0) < 0));
  if (!revenueAvailable) warnings.push("Revenue cannot be safely calculated because no revenue or credit column/classification is available.");
  if (!expensesAvailable) warnings.push("Expenses cannot be safely calculated because no expense or debit column/classification is available.");
  if (debitCreditFields && !debitCreditClassificationAvailable) warnings.push("Debit and credit columns alone do not identify revenue versus expense. Add a category or description column with account classifications.");

  const rows: FinancialRow[] = input.rows.map((raw, index) => {
    const category = textFrom(raw, detectedColumns.category);
    const description = textFrom(raw, detectedColumns.description);
    const direction = categoryDirection(category) ?? categoryDirection(description);
    const rawRevenue = numberFrom(raw, detectedColumns.revenue);
    const rawExpense = numberFrom(raw, detectedColumns.expense);
    const rawDebit = numberFrom(raw, detectedColumns.debit);
    const rawCredit = numberFrom(raw, detectedColumns.credit);
    const amount = numberFrom(raw, detectedColumns.amount);
    const revenueColumnUsable = Boolean(detectedColumns.revenue);
    const expenseColumnUsable = Boolean(detectedColumns.expense);
    const debitUsable = Boolean(detectedColumns.debit);
    const creditUsable = Boolean(detectedColumns.credit);
    let revenue = 0;
    let expense = 0;
    let skipReason: string | undefined;

    if (revenueColumnUsable || expenseColumnUsable) {
      if (rawRevenue === null && rawExpense === null) {
        skipReason = "Revenue or expense value is not numeric.";
      } else {
        revenue = Math.abs(rawRevenue ?? 0);
        expense = Math.abs(rawExpense ?? 0);
      }
    } else if (debitUsable || creditUsable) {
      if (!direction) {
        skipReason = "Debit and credit values do not identify revenue or expense without a recognizable category or description.";
      } else if (rawDebit === null && rawCredit === null) {
        skipReason = "Debit or credit value is not numeric.";
      } else if ((rawDebit ?? 0) !== 0 && (rawCredit ?? 0) !== 0) {
        skipReason = "Both debit and credit are populated, so the row's financial direction is ambiguous.";
      } else if (direction === "expense" && rawCredit !== null && rawCredit !== 0) {
        skipReason = "An expense category has a credit amount; review the accounting sign convention for this row.";
      } else if (direction === "revenue" && rawDebit !== null && rawDebit !== 0) {
        skipReason = "A revenue category has a debit amount; review the accounting sign convention for this row.";
      } else {
        expense = direction === "expense" ? Math.abs(rawDebit ?? 0) : 0;
        revenue = direction === "revenue" ? Math.abs(rawCredit ?? 0) : 0;
      }
    } else if (detectedColumns.amount) {
      if (amount === null) {
        skipReason = "Amount value is not numeric.";
      } else if (direction === "revenue") {
        revenue = Math.abs(amount);
      } else if (direction === "expense") {
        expense = Math.abs(amount);
      } else if (amount < 0) {
        expense = Math.abs(amount);
      } else {
        skipReason = "Positive amount has no clear revenue or expense category.";
      }
    } else {
      skipReason = "No unambiguous financial amount column is available.";
    }

    const normalizedRaw = Object.fromEntries(Object.entries(raw).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : String(value),
    ]));

    return {
      rowNumber: index + 1,
      date: textFrom(raw, detectedColumns.date),
      description,
      category,
      revenue,
      expense,
      amount: amount ?? undefined,
      debit: rawDebit ?? undefined,
      credit: rawCredit ?? undefined,
      profit: numberFrom(raw, detectedColumns.profit) ?? undefined,
      analyzed: !skipReason,
      skipReason,
      raw: normalizedRaw,
    };
  });

  const rowsAnalyzed = rows.filter((row) => row.analyzed).length;
  const rowsSkipped = rows.length - rowsAnalyzed;
  if (rowsSkipped > 0) {
    warnings.push(`${rowsSkipped} of ${rows.length} data row(s) could not be safely classified and were excluded from totals.`);
  }
  if (rowsAnalyzed === 0 && rows.length > 0) {
    warnings.push("No rows could be safely analyzed. Totals are shown as zero and should not be treated as reliable.");
  }

  const revenueTotal = rows.reduce((sum, row) => sum + (row.analyzed ? row.revenue : 0), 0);
  const expensesTotal = rows.reduce((sum, row) => sum + (row.analyzed ? row.expense : 0), 0);
  const unitSafe = currency.status !== "ambiguous";
  const revenue = revenueAvailable && unitSafe ? revenueTotal : null;
  const expenses = expensesAvailable && unitSafe ? expensesTotal : null;
  const profit = revenue !== null && expenses !== null ? revenue - expenses : null;
  const qualityResult = qualityFor(rowsAnalyzed, rowsSkipped, warnings.length + errors.length, revenueAvailable && expensesAvailable);
  const summary: FinancialSummary = {
    totalRows: rows.length,
    rowsAnalyzed,
    rowsSkipped,
    revenue,
    expenses,
    profit,
    expenseRatio: revenue !== null && expenses !== null && revenue > 0 ? (expenses / revenue) * 100 : null,
    profitMargin: revenue !== null && profit !== null && revenue > 0 ? (profit / revenue) * 100 : null,
    ...qualityResult,
  };

  return { uploadedFile, currency, columns: input.columns, detectedColumns, rows, summary, warnings, errors };
}

export function createUploadedFile(file: Pick<File, "name" | "size" | "type">): UploadedFile {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    size: file.size,
    type: file.type,
    uploadedAt: new Date().toISOString(),
  };
}
