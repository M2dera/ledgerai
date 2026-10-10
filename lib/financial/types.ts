export type FinancialField =
  | "date"
  | "description"
  | "category"
  | "revenue"
  | "expense"
  | "amount"
  | "debit"
  | "credit"
  | "profit";

export type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
};

export type FinancialUnit = {
  status: "known" | "unknown" | "ambiguous";
  code: string | null;
  source: "header" | "cell" | "unknown";
  candidates: string[];
};

export type FinancialFactUnit =
  | { kind: "currency"; unit: FinancialUnit }
  | { kind: "percentage" };

export type FinancialRow = {
  rowNumber: number;
  date?: string;
  description?: string;
  category?: string;
  revenue: number;
  expense: number;
  amount?: number;
  debit?: number;
  credit?: number;
  profit?: number;
  analyzed: boolean;
  skipReason?: string;
  raw: Record<string, string | number | boolean | null>;
};

export type FinancialQuality = "high" | "medium" | "low";

export type FinancialSummary = {
  totalRows: number;
  rowsAnalyzed: number;
  rowsSkipped: number;
  revenue: number | null;
  expenses: number | null;
  profit: number | null;
  expenseRatio: number | null;
  profitMargin: number | null;
  quality: FinancialQuality;
  confidence: number;
};

export type Insight = {
  id: string;
  message: string;
  level: "info" | "warning" | "good";
};

export type Alert = {
  id: string;
  level: "high" | "medium" | "good";
  message: string;
};

export type DetectedColumns = Partial<Record<FinancialField, string>>;

export type FinancialDataset = {
  uploadedFile: UploadedFile;
  currency: FinancialUnit;
  columns: string[];
  detectedColumns: DetectedColumns;
  rows: FinancialRow[];
  summary: FinancialSummary;
  warnings: string[];
  errors: string[];
};

export type FinancialPeriod = {
  id: string;
  label: string;
  year: number;
  month: number;
  revenue: number | null;
  expenses: number | null;
  profit: number | null;
  rowsAnalyzed: number;
};

export type PeriodComparison = {
  earlier: FinancialPeriod;
  later: FinancialPeriod;
  revenueDelta: number | null;
  expenseDelta: number | null;
  profitDelta: number | null;
  revenuePercentChange: number | null;
  expensePercentChange: number | null;
  profitPercentChange: number | null;
};

export type IngestionResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  warnings: string[];
  errors: string[];
};

export type UploadFeedback = {
  status: "idle" | "loading" | "success" | "error";
  message: string;
  warnings: string[];
  errors: string[];
};
