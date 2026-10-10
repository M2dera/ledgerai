import { BALANCE_TOLERANCE, calculateAccountBalances } from "./ledger";
import type { Account, BalanceSheetClassification, BalanceSheetStatement, JournalEntry, ProfitAndLossClassification } from "./types";

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

/** Include earnings from the same journals in statement equity without posting a closing entry or balancing plug. */
export function createBalanceSheetStatement(entries: readonly JournalEntry[], accounts: readonly Account[]): BalanceSheetStatement {
  const classified = classifyBalanceSheet(entries, accounts);
  const profitAndLoss = classifyProfitAndLoss(entries, accounts);
  const totalAccountEquity = classified.totalEquity;
  const currentEarnings = profitAndLoss.netIncome;
  const totalEquity = totalAccountEquity + currentEarnings;
  const totalLiabilitiesAndEquity = classified.totalLiabilities + totalEquity;
  const difference = classified.totalAssets - totalLiabilitiesAndEquity;
  const finiteTotals = [classified.totalAssets, classified.totalLiabilities, totalAccountEquity,
    profitAndLoss.totalRevenue, profitAndLoss.totalExpenses, currentEarnings,
    totalEquity, totalLiabilitiesAndEquity, difference].every(Number.isFinite);
  const finiteBalances = [...classified.assets, ...classified.liabilities, ...classified.equity,
    ...profitAndLoss.revenue, ...profitAndLoss.expenses].every(({ debitTotal, creditTotal, balance }) =>
      Number.isFinite(debitTotal) && Number.isFinite(creditTotal) && Number.isFinite(balance));
  return {
    ...classified,
    totalAccountEquity,
    currentEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    difference,
    balanced: finiteTotals && finiteBalances && Math.abs(difference) <= BALANCE_TOLERANCE,
    balanceTolerance: BALANCE_TOLERANCE,
  };
}
