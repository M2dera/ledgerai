import { calculateAccountBalances } from "./ledger";
import type { Account, BalanceSheetClassification, JournalEntry, ProfitAndLossClassification } from "./types";

export function classifyProfitAndLoss(entries: readonly JournalEntry[], accounts: readonly Account[]): ProfitAndLossClassification {
  const balances = calculateAccountBalances(entries, accounts);
  const revenue = balances.filter(({ account }) => account.type === "revenue");
  const expenses = balances.filter(({ account }) => account.type === "expense");
  const totalRevenue = revenue.reduce((total, account) => total + account.balance, 0);
  const totalExpenses = expenses.reduce((total, account) => total + account.balance, 0);
  return { currency: balances[0]?.currency ?? null, revenue, expenses, totalRevenue, totalExpenses, netIncome: totalRevenue - totalExpenses };
}

export function classifyBalanceSheet(entries: readonly JournalEntry[], accounts: readonly Account[]): BalanceSheetClassification {
  const balances = calculateAccountBalances(entries, accounts);
  const assets = balances.filter(({ account }) => account.type === "asset");
  const liabilities = balances.filter(({ account }) => account.type === "liability");
  const equity = balances.filter(({ account }) => account.type === "equity");
  return {
    currency: balances[0]?.currency ?? null,
    assets,
    liabilities,
    equity,
    totalAssets: assets.reduce((total, account) => total + account.balance, 0),
    totalLiabilities: liabilities.reduce((total, account) => total + account.balance, 0),
    totalEquity: equity.reduce((total, account) => total + account.balance, 0),
  };
}
