import type { FinancialDataset, FinancialRow } from "@/lib/financial/types";
import { DEFAULT_CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import type { Account, AccountBalance, JournalEntry } from "./types";

export type FinancialAccountingMappingIssueCode =
  | "INVALID_DATASET"
  | "CURRENCY_UNAVAILABLE"
  | "INVALID_CURRENCY"
  | "NO_MAPPABLE_DATA"
  | "ROW_NOT_ANALYZED"
  | "AMBIGUOUS_FINANCIAL_DIRECTION"
  | "UNMAPPED_EXPENSE_CATEGORY"
  | "ACCOUNT_NOT_FOUND"
  | "MISSING_COUNTER_ACCOUNT";

export type FinancialAccountingMappingIssue = {
  code: FinancialAccountingMappingIssueCode;
  message: string;
  scope: "dataset" | "balance" | "journal-entry";
  rowNumber?: number;
};

export type FinancialAccountingMapping = {
  currency: string;
  balances: AccountBalance[];
  journalEntries: JournalEntry[];
  issues: FinancialAccountingMappingIssue[];
};

export type FinancialAccountingMappingResult =
  | { ok: true; value: FinancialAccountingMapping }
  | { ok: false; errors: FinancialAccountingMappingIssue[] };

const EXPENSE_ACCOUNT_PATTERNS: ReadonlyArray<{ accountId: string; pattern: RegExp }> = [
  { accountId: "rent-expense", pattern: /^(?:rent|rent expense|lease|rental|ايجار|الايجار)$/u },
  { accountId: "salaries-expense", pattern: /^(?:salary|salaries|salary expense|salaries expense|payroll|wage|wages|رواتب|الرواتب|راتب|اجور|الاجور)$/u },
  { accountId: "utilities-expense", pattern: /^(?:utilities|utilities expense|utility|electricity|water|كهرباء|الكهرباء|ماء|الماء|مرافق|المرافق)$/u },
];

function normalizeLabel(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function expenseAccountId(row: FinancialRow): string | null {
  const labels = [normalizeLabel(row.category), normalizeLabel(row.description)].filter(Boolean);
  for (const label of labels) {
    const match = EXPENSE_ACCOUNT_PATTERNS.find(({ pattern }) => pattern.test(label));
    if (match) return match.accountId;
  }
  return null;
}

function issue(
  code: FinancialAccountingMappingIssueCode,
  scope: FinancialAccountingMappingIssue["scope"],
  message: string,
  rowNumber?: number,
): FinancialAccountingMappingIssue {
  return { code, scope, message, ...(rowNumber === undefined ? {} : { rowNumber }) };
}

function addAmount(totals: Map<string, { debit: number; credit: number }>, accountId: string, debit: number, credit: number): void {
  const current = totals.get(accountId) ?? { debit: 0, credit: 0 };
  totals.set(accountId, { debit: current.debit + debit, credit: current.credit + credit });
}

function toBalance(account: Account, currency: string, debitTotal: number, creditTotal: number): AccountBalance {
  const debitNormal = account.type === "asset" || account.type === "expense";
  return {
    account,
    currency,
    debitTotal,
    creditTotal,
    balance: debitNormal ? debitTotal - creditTotal : creditTotal - debitTotal,
  };
}

export function mapFinancialDatasetToAccounting(
  dataset: FinancialDataset,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): FinancialAccountingMappingResult {
  if (dataset.errors.length > 0) {
    return { ok: false, errors: [issue("INVALID_DATASET", "dataset", "The financial dataset contains ingestion or analysis errors.")] };
  }
  if (dataset.currency.status !== "known" || !dataset.currency.code) {
    return { ok: false, errors: [issue("CURRENCY_UNAVAILABLE", "dataset", "A single verified currency is required for accounting mapping.")] };
  }
  if (!/^[A-Z]{3}$/.test(dataset.currency.code)) {
    return { ok: false, errors: [issue("INVALID_CURRENCY", "dataset", "The verified currency must be an uppercase three-letter code.")] };
  }

  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const totals = new Map<string, { debit: number; credit: number }>();
  const issues: FinancialAccountingMappingIssue[] = [];

  for (const row of dataset.rows) {
    if (!row.analyzed) {
      issues.push(issue("ROW_NOT_ANALYZED", "balance", "The source row was not safely analyzed and was not mapped.", row.rowNumber));
      continue;
    }
    const revenue = Number.isFinite(row.revenue) && row.revenue > 0 ? row.revenue : 0;
    const expense = Number.isFinite(row.expense) && row.expense > 0 ? row.expense : 0;
    if (revenue > 0 && expense > 0) {
      issues.push(issue("AMBIGUOUS_FINANCIAL_DIRECTION", "balance", "A row containing both revenue and expense cannot be mapped safely.", row.rowNumber));
      continue;
    }
    if (revenue > 0) {
      if (!accountMap.has("revenue")) {
        issues.push(issue("ACCOUNT_NOT_FOUND", "balance", "The chart of accounts has no Revenue account.", row.rowNumber));
        continue;
      }
      addAmount(totals, "revenue", 0, revenue);
      issues.push(issue("MISSING_COUNTER_ACCOUNT", "journal-entry", "No journal entry was created because the revenue counteraccount is not present in the source data.", row.rowNumber));
      continue;
    }
    if (expense > 0) {
      const accountId = expenseAccountId(row);
      if (!accountId) {
        issues.push(issue("UNMAPPED_EXPENSE_CATEGORY", "balance", "The expense category does not map unambiguously to the default chart of accounts.", row.rowNumber));
        continue;
      }
      if (!accountMap.has(accountId)) {
        issues.push(issue("ACCOUNT_NOT_FOUND", "balance", `The chart of accounts has no ${accountId} account.`, row.rowNumber));
        continue;
      }
      addAmount(totals, accountId, expense, 0);
      issues.push(issue("MISSING_COUNTER_ACCOUNT", "journal-entry", "No journal entry was created because the expense counteraccount is not present in the source data.", row.rowNumber));
    }
  }

  const balances = [...totals.entries()].map(([accountId, amount]) =>
    toBalance(accountMap.get(accountId)!, dataset.currency.code!, amount.debit, amount.credit),
  );
  if (balances.length === 0) {
    return {
      ok: false,
      errors: [issue("NO_MAPPABLE_DATA", "dataset", "The dataset contains no financial rows that map unambiguously to accounting balances."), ...issues],
    };
  }

  return { ok: true, value: { currency: dataset.currency.code, balances, journalEntries: [], issues } };
}
