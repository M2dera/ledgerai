import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateAccountBalance } from "@/lib/accounting/ledger";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import type { Account } from "@/lib/accounting/types";
import { getBalanceSheetReport } from "@/lib/balance-sheet";
import { getProfitLossReport } from "@/lib/profit-loss";
import { getTrialBalanceReport } from "@/lib/trial-balance";

export type AccountingQuestionIntent =
  | "revenue"
  | "expenses"
  | "net_income"
  | "account_balance"
  | "largest_expense"
  | "total_assets"
  | "total_liabilities"
  | "total_equity"
  | "balance_sheet_totals"
  | "trial_balance_status"
  | "clarification";

export type AccountingQuestionResult = {
  route: "accounting_ledger";
  intent: AccountingQuestionIntent;
  text: string;
};

type ParsedQuestion = { intent: AccountingQuestionIntent; asOfDate?: string; accountIds?: string[]; clarification?: string };

const SOURCE = "Source: Posted accounting entries in this session.";
const SUPPORTED = "I can answer posted-ledger questions about revenue, expenses, net profit or loss, an account balance, the largest expense account, Balance Sheet totals, and Trial Balance status.";

function normalizeQuestion(question: string): string {
  return question.toLocaleLowerCase().normalize("NFKC").normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    .replace(/\s+/g, " ").trim();
}

function hasLedgerSource(question: string): boolean {
  return /\b(?:posted|ledger|accounting entries|accounting transactions|posted entries|posted transactions)\b/i.test(question) ||
    /\btrial balance\b|\bbalance sheet\b/i.test(question) ||
    /\u0627\u0644\u0642\u064A\u0648\u062F\s+\u0627\u0644\u0645\u0631\u062D\u0644\u0647|\u0627\u0644\u0642\u064A\u0648\u062F\s+\u0627\u0644\u0645\u062D\u0627\u0633\u0628\u064A\u0647|\u062F\u0641\u062A\u0631\s+\u0627\u0644\u0627\u0633\u062A\u0627\u0630|\u0645\u064A\u0632\u0627\u0646\s+\u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0647|\u0645\u064A\u0632\u0627\u0646\u064A\u0647\s+\u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0647/u.test(question);
}

function accountMatches(question: string, accounts: readonly Account[]): string[] {
  const aliases: Record<string, string[]> = {
    bank: ["\u0627\u0644\u0628\u0646\u0643", "\u0627\u0644\u0628\u0646\u0643\u064A"],
    cash: ["\u0627\u0644\u0635\u0646\u062F\u0648\u0642", "\u0646\u0642\u062F"],
  };
  return accounts.filter((account) => {
    const name = normalizeQuestion(account.name);
    const code = account.code.toLocaleLowerCase();
    const aliasMatches = (aliases[account.id] ?? []).some((alias) => question.includes(normalizeQuestion(alias)));
    return question.includes(name) || new RegExp(`(?:^|\\D)${code}(?:$|\\D)`).test(question) || aliasMatches;
  }).map(({ id }) => id);
}

function parseQuestion(question: string, accounts: readonly Account[]): ParsedQuestion | undefined {
  const text = normalizeQuestion(question);
  const accountIds = accountMatches(text, accounts);
  const hasAccountBalance = /\b(?:account\s+)?balance\b|\bbalances\b|\u0631\u0635\u064A\u062F/u.test(text);
  const isTrialBalance = /\btrial\s+balance\b|\u0645\u064A\u0632\u0627\u0646\s+\u0645\u0631\u0627\u062C\u0639\u0647/u.test(text);
  const isBalanceSheet = /\bbalance\s+sheet\b|\u0645\u064A\u0632\u0627\u0646\u064A\u0647\s+\u0639\u0645\u0648\u0645\u064A\u0647/u.test(text);
  const explicitSource = hasLedgerSource(text);
  const hasDateCue = /\b(?:as\s+of|through|up\s+to|until|as\s+at)\b|\u062D\u062A\u064A\s+\u062A\u0627\u0631\u064A\u062E/u.test(text);
  const dateMatches = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
  if (!explicitSource && !hasAccountBalance && !isTrialBalance && !isBalanceSheet) return undefined;
  if (dateMatches.length > 1 || (hasDateCue && dateMatches.length !== 1) || (dateMatches.length === 1 && !hasDateCue)) {
    return { intent: "clarification", clarification: "Please provide one explicit inclusive cutoff using YYYY-MM-DD, for example: as of 2026-10-10." };
  }

  const asOfDate = dateMatches[0];
  const asksNetIncome = /\b(?:net\s+profit|net\s+income|profit\s+or\s+loss)\b|\u0635\u0627\u0641\u064A\s+\u0627\u0644\u0631\u0628\u062D/u.test(text);
  const asksRevenue = /\b(?:revenue|income|sales)\b|\u0627\u0644\u0627\u064A\u0631\u0627\u062F\u0627\u062A/u.test(text);
  const asksExpenses = /\b(?:expenses?|spending|costs?)\b|\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641/u.test(text);
  if (!isBalanceSheet && !isTrialBalance && !hasAccountBalance &&
      Number(asksNetIncome) + Number(asksRevenue) + Number(asksExpenses) > 1) {
    return { intent: "clarification", asOfDate, clarification: "Please ask for one Profit & Loss measure at a time: revenue, expenses, or net profit or loss." };
  }
  if (isTrialBalance) {
    if (/\bbalanced\b|\bout\s+of\s+balance\b|\u0645\u062A\u0648\u0627\u0632\u0646/u.test(text)) return { intent: "trial_balance_status", asOfDate };
    return { intent: "clarification", asOfDate, clarification: "Ask whether the Trial Balance is balanced or out of balance." };
  }
  if (isBalanceSheet) {
    if (asksNetIncome || asksRevenue || asksExpenses) return { intent: "clarification", asOfDate, clarification: "Please ask for one Balance Sheet or Profit & Loss measure at a time." };
    const hasAssets = /\bassets?\b|\u0627\u0644\u0627\u0635\u0648\u0644/u.test(text);
    const hasLiabilities = /\bliabilit(?:y|ies)\b|\u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645\u0627\u062A/u.test(text);
    const hasEquity = /\bequity\b|\u062D\u0642\u0648\u0642\s+\u0627\u0644\u0645\u0644\u0643\u064A\u0647/u.test(text);
    const selected = [hasAssets, hasLiabilities, hasEquity].filter(Boolean).length;
    if (selected > 1) return { intent: "balance_sheet_totals", asOfDate };
    if (hasAssets) return { intent: "total_assets", asOfDate };
    if (hasLiabilities) return { intent: "total_liabilities", asOfDate };
    if (hasEquity) return { intent: "total_equity", asOfDate };
    return { intent: "clarification", asOfDate, clarification: "Specify whether you want total assets, liabilities, or equity from the Balance Sheet." };
  }
  if (hasAccountBalance) return { intent: "account_balance", asOfDate, accountIds };
  if (/\b(?:largest|highest|biggest|top)\b.{0,60}\b(?:expense|expenses|spending|cost)\b|\b(?:expense|expenses|spending|cost)\b.{0,60}\b(?:largest|highest|biggest|top)\b|\u0627\u0643\u062B\u0631.{0,30}\u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641/u.test(text)) {
    return { intent: "largest_expense", asOfDate };
  }
  if (asksNetIncome) return { intent: "net_income", asOfDate };
  if (asksRevenue) return { intent: "revenue", asOfDate };
  if (asksExpenses) return { intent: "expenses", asOfDate };
  if (/\bassets?\b|\u0627\u0644\u0627\u0635\u0648\u0644/u.test(text)) return { intent: "total_assets", asOfDate };
  if (/\bliabilit(?:y|ies)\b|\u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645\u0627\u062A/u.test(text)) return { intent: "total_liabilities", asOfDate };
  if (/\bequity\b|\u062D\u0642\u0648\u0642\s+\u0627\u0644\u0645\u0644\u0643\u064A\u0647/u.test(text)) return { intent: "total_equity", asOfDate };
  return { intent: "clarification" };
}

function sourceText(message: string): AccountingQuestionResult {
  return { route: "accounting_ledger", intent: "clarification", text: `${message}\n${SOURCE}` };
}

function amount(value: number, currency: string | null): string | undefined {
  return currency ? `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${currency}` : undefined;
}

function selectThroughDate(ledger: Pick<AccountingLedgerState, "journalEntries">, date?: string) {
  return date ? ledger.journalEntries.filter((entry) => entry.date <= date) : ledger.journalEntries;
}

/** Deterministic, read-only answers over only posted session entries. */
export function answerAccountingQuestion(
  question: string,
  ledger: Pick<AccountingLedgerState, "journalEntries"> | null | undefined,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): AccountingQuestionResult | undefined {
  const parsed = parseQuestion(question, accounts);
  if (!parsed) return undefined;
  if (parsed.intent === "clarification") return sourceText(parsed.clarification ?? SUPPORTED);
  if (!ledger || !Array.isArray(ledger.journalEntries)) return sourceText("The accounting session ledger is unavailable. No workbook data was used.");
  if (!ledger.journalEntries.length) return sourceText("There are no posted accounting entries in this session yet. Draft and unposted transactions are not included.");

  const periodThrough = parsed.asOfDate ? ` through ${parsed.asOfDate} (inclusive)` : " across all posted journal dates";
  const cumulativeThrough = parsed.asOfDate ? ` as of ${parsed.asOfDate} (inclusive)` : " as of the current posted ledger";
  try {
    if (parsed.intent === "revenue" || parsed.intent === "expenses" || parsed.intent === "net_income" || parsed.intent === "largest_expense") {
      const report = getProfitLossReport(ledger, parsed.asOfDate ? { endDate: parsed.asOfDate } : {});
      if (report.status === "error") return sourceText(`Unable to safely read the posted ledger: ${report.message}`);
      if (parsed.asOfDate && report.includedEntryCount === 0) return sourceText(`No posted entries are dated on or before ${parsed.asOfDate}. No report amount was calculated.`);
      if (!report.currency) return sourceText("The posted ledger has no validated currency, so an amount cannot be reported.");
      const values = report.profitAndLoss;
      if (parsed.intent === "revenue") return { route: "accounting_ledger", intent: parsed.intent, text: `Posted revenue${periodThrough}: ${amount(values.totalRevenue, report.currency)}.\n${SOURCE}` };
      if (parsed.intent === "expenses") return { route: "accounting_ledger", intent: parsed.intent, text: `Posted expenses${periodThrough}: ${amount(values.totalExpenses, report.currency)}.\n${SOURCE}` };
      if (parsed.intent === "net_income") {
        const label = values.netIncome > 0 ? "net profit" : values.netIncome < 0 ? "net loss" : "net profit or loss";
        return { route: "accounting_ledger", intent: parsed.intent, text: `Posted ${label}${periodThrough}: ${amount(Math.abs(values.netIncome), report.currency)}.\n${SOURCE}` };
      }
      const largest = values.expenses.filter((line) => line.balance > 0).reduce<typeof values.expenses[number] | undefined>(
        (current, line) => !current || line.balance > current.balance ? line : current, undefined,
      );
      const result = largest
        ? `Largest expense account${periodThrough}: ${largest.account.name}, ${amount(largest.balance, report.currency)}.`
        : `No account has a positive net expense balance${periodThrough}.`;
      return { route: "accounting_ledger", intent: parsed.intent, text: `${result}\n${SOURCE}` };
    }

    if (parsed.intent === "account_balance") {
      if (!parsed.accountIds?.length) return sourceText("Which account balance do you mean? Give the Chart of Accounts name or code, such as Bank (1010) or Cash (1000).\n" + SUPPORTED);
      if (parsed.accountIds.length !== 1) return sourceText("That account reference is ambiguous. Please name one account or provide its Chart of Accounts code.");
      const report = getTrialBalanceReport(ledger, parsed.asOfDate);
      if (report.status === "error") return sourceText(`Unable to safely read the posted ledger: ${report.message}`);
      if (parsed.asOfDate && report.includedEntryCount === 0) return sourceText(`No posted entries are dated on or before ${parsed.asOfDate}. No Trial Balance was calculated.`);
      const account = accounts.find(({ id }) => id === parsed.accountIds![0]);
      if (!account) return sourceText("That account is not present in the Chart of Accounts. Please use an account name or code from the chart.");
      const balance = calculateAccountBalance(account, selectThroughDate(ledger, parsed.asOfDate), accounts);
      const formatted = amount(Math.abs(balance.balance), balance.currency);
      if (!formatted) return sourceText("The posted ledger has no validated currency, so an account balance cannot be reported.");
      const side = balance.balance < 0 ? "contra-normal" : "normal-side";
      return { route: "accounting_ledger", intent: parsed.intent, text: `${account.name} balance${cumulativeThrough}: ${formatted} (${side} balance).\n${SOURCE}` };
    }

    if (parsed.intent === "trial_balance_status") {
      const report = getTrialBalanceReport(ledger, parsed.asOfDate);
      if (report.status === "error") return sourceText(`Unable to safely read the posted ledger: ${report.message}`);
      const status = report.trialBalance.balanced ? "Balanced" : "Out of balance";
      const difference = report.currency ? ` Difference: ${amount(Math.abs(report.trialBalance.difference), report.currency)}.` : "";
      return { route: "accounting_ledger", intent: parsed.intent, text: `Trial Balance${cumulativeThrough}: ${status}.${difference}\n${SOURCE}` };
    }

    const report = getBalanceSheetReport(ledger, parsed.asOfDate);
    if (report.status === "error") return sourceText(`Unable to safely read the posted ledger: ${report.message}`);
    if (parsed.asOfDate && report.includedEntryCount === 0) return sourceText(`No posted entries are dated on or before ${parsed.asOfDate}. No Balance Sheet was calculated.`);
    if (!report.currency) return sourceText("The posted ledger has no validated currency, so a Balance Sheet amount cannot be reported.");
    if (parsed.intent === "balance_sheet_totals") {
      return { route: "accounting_ledger", intent: parsed.intent, text: `Balance Sheet${cumulativeThrough}: assets ${amount(report.balanceSheet.totalAssets, report.currency)}, liabilities ${amount(report.balanceSheet.totalLiabilities, report.currency)}, and equity including current earnings ${amount(report.balanceSheet.totalEquity, report.currency)}.\n${SOURCE}` };
    }
    const labels: Record<"total_assets" | "total_liabilities" | "total_equity", string> = {
      total_assets: "Total assets",
      total_liabilities: "Total liabilities",
      total_equity: "Total equity, including current earnings",
    };
    const value = parsed.intent === "total_assets" ? report.balanceSheet.totalAssets
      : parsed.intent === "total_liabilities" ? report.balanceSheet.totalLiabilities
        : report.balanceSheet.totalEquity;
    return { route: "accounting_ledger", intent: parsed.intent, text: `${labels[parsed.intent]}${cumulativeThrough}: ${amount(value, report.currency)}.\n${SOURCE}` };
  } catch (error) {
    return sourceText(`Unable to safely read the posted ledger: ${error instanceof Error ? error.message : "Accounting data is invalid."}`);
  }
}

/** Exposed for focused parser tests without invoking report calculations. */
export function classifyAccountingQuestion(question: string, accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS): AccountingQuestionIntent | undefined {
  return parseQuestion(question, accounts)?.intent;
}
