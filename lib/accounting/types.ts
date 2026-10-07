export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  category?: "fixed-assets";
};

export type JournalEntryLine = {
  accountId: string;
  debit: number;
  credit: number;
};

export type JournalEntry = {
  id: string;
  date: string;
  description: string;
  currency: string;
  lines: JournalEntryLine[];
};

export type JournalEntryValidationErrorCode =
  | "MISSING_CURRENCY"
  | "INVALID_CURRENCY"
  | "INSUFFICIENT_LINES"
  | "INVALID_AMOUNT"
  | "NEGATIVE_AMOUNT"
  | "SIMULTANEOUS_DEBIT_CREDIT"
  | "ACCOUNT_NOT_FOUND"
  | "UNBALANCED_ENTRY";

export type JournalEntryValidationError = {
  code: JournalEntryValidationErrorCode;
  message: string;
  lineIndex?: number;
  accountId?: string;
};

export type JournalEntryValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: JournalEntryValidationError[] };

export type AccountBalance = {
  account: Account;
  currency: string | null;
  debitTotal: number;
  creditTotal: number;
  balance: number;
};

export type LedgerTotals = {
  currency: string | null;
  debitTotal: number;
  creditTotal: number;
};

export type TrialBalanceLine = {
  account: Account;
  debitBalance: number;
  creditBalance: number;
};

export type TrialBalance = {
  currency: string | null;
  lines: TrialBalanceLine[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
};

export type ProfitAndLossClassification = {
  currency: string | null;
  revenue: AccountBalance[];
  expenses: AccountBalance[];
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
};

export type BalanceSheetClassification = {
  currency: string | null;
  assets: AccountBalance[];
  liabilities: AccountBalance[];
  equity: AccountBalance[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
};
