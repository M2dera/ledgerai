import type { FinancialDataset } from "@/lib/financial/types";

const STORAGE_KEY = "ledgerai-financial-data";
export const STORAGE_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalFinite(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

export function isFinancialDataset(value: unknown): value is FinancialDataset {
  if (!isRecord(value) || !isRecord(value.uploadedFile) || !isRecord(value.summary) || !isRecord(value.currency)) return false;
  const currency = value.currency;
  if (!(["known", "unknown", "ambiguous"].includes(String(currency.status)) &&
    ["header", "cell", "unknown"].includes(String(currency.source)) &&
    (currency.code === null || typeof currency.code === "string") && Array.isArray(currency.candidates) &&
    currency.candidates.every((candidate) => typeof candidate === "string") &&
    (currency.status !== "known" || typeof currency.code === "string") &&
    (currency.status !== "ambiguous" || currency.code === null))) return false;
  const file = value.uploadedFile;
  const summary = value.summary;
  if (
    typeof file.id !== "string" || typeof file.name !== "string" ||
    typeof file.size !== "number" || !Number.isFinite(file.size) || file.size < 0 ||
    typeof file.type !== "string" || typeof file.uploadedAt !== "string"
  ) return false;
  if (
    !Array.isArray(value.columns) || !value.columns.every((item) => typeof item === "string") ||
    !Array.isArray(value.rows) || !Array.isArray(value.warnings) || !value.warnings.every((item) => typeof item === "string") ||
    !Array.isArray(value.errors) || !value.errors.every((item) => typeof item === "string") ||
    !isRecord(value.detectedColumns) || !Object.values(value.detectedColumns).every((item) => typeof item === "string")
  ) return false;
  if (!value.rows.every((row) => isRecord(row) && typeof row.rowNumber === "number" && Number.isInteger(row.rowNumber) && row.rowNumber > 0 &&
    typeof row.revenue === "number" && Number.isFinite(row.revenue) &&
    typeof row.expense === "number" && Number.isFinite(row.expense) &&
    isOptionalFinite(row.amount) && isOptionalFinite(row.debit) && isOptionalFinite(row.credit) && isOptionalFinite(row.profit) &&
    [row.date, row.description, row.category, row.skipReason].every((item) => item === undefined || typeof item === "string") &&
    typeof row.analyzed === "boolean" && isRecord(row.raw) && Object.values(row.raw).every((item) => item === null || ["string", "number", "boolean"].includes(typeof item)))) return false;

  const rowsAnalyzed = value.rows.filter((row) => isRecord(row) && row.analyzed === true).length;
  const rowsSkipped = value.rows.length - rowsAnalyzed;
  const analyzedRows = value.rows.filter((row): row is Record<string, unknown> => isRecord(row) && row.analyzed === true);
  const calculatedRevenue = analyzedRows.reduce((sum, row) => sum + (row.revenue as number), 0);
  const calculatedExpenses = analyzedRows.reduce((sum, row) => sum + (row.expense as number), 0);
  return Number.isInteger(summary.totalRows) && summary.totalRows === value.rows.length &&
    Number.isInteger(summary.rowsAnalyzed) && summary.rowsAnalyzed === rowsAnalyzed &&
    Number.isInteger(summary.rowsSkipped) && summary.rowsSkipped === rowsSkipped &&
    isNumberOrNull(summary.revenue) && isNumberOrNull(summary.expenses) && isNumberOrNull(summary.profit) &&
    (summary.revenue === null || summary.revenue === calculatedRevenue) &&
    (summary.expenses === null || summary.expenses === calculatedExpenses) &&
    isNumberOrNull(summary.expenseRatio) && isNumberOrNull(summary.profitMargin) &&
    (summary.quality === "high" || summary.quality === "medium" || summary.quality === "low") &&
    typeof summary.confidence === "number" && Number.isFinite(summary.confidence) && summary.confidence >= 0 && summary.confidence <= 100 &&
    (summary.revenue === null || summary.expenses === null ? summary.profit === null && summary.expenseRatio === null && summary.profitMargin === null :
      summary.profit === summary.revenue - (summary.expenses as number) &&
      (summary.revenue === 0 ? summary.expenseRatio === null && summary.profitMargin === null :
        summary.expenseRatio === (summary.expenses as number) / summary.revenue * 100 && summary.profitMargin === summary.profit / summary.revenue * 100));
}

export function deserializeFinancialDataset(serialized: string | null): FinancialDataset | null {
  if (!serialized) return null;
  try {
    const envelope: unknown = JSON.parse(serialized);
    if (!isRecord(envelope) || envelope.version !== STORAGE_VERSION || !isFinancialDataset(envelope.dataset)) return null;
    return envelope.dataset;
  } catch {
    return null;
  }
}

export function saveFinancialDataset(dataset: FinancialDataset): boolean {
  if (typeof window === "undefined" || !isFinancialDataset(dataset)) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, dataset }));
    return true;
  } catch {
    return false;
  }
}

export function loadFinancialDataset(): FinancialDataset | null {
  if (typeof window === "undefined") return null;
  try {
    const serialized = window.localStorage.getItem(STORAGE_KEY);
    const dataset = deserializeFinancialDataset(serialized);
    if (serialized && !dataset) window.localStorage.removeItem(STORAGE_KEY);
    return dataset;
  } catch {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
    return null;
  }
}
