import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import type { Account, AccountBalance } from "@/lib/accounting/types";
import { getBalanceSheetReport } from "@/lib/balance-sheet";
import { getProfitLossReport } from "@/lib/profit-loss";

export type DashboardAccountingReport =
  | { status: "error"; message: string }
  | { status: "empty"; currency: null; postedEntryCount: 0 }
  | {
    status: "ready";
    currency: string;
    postedEntryCount: number;
    undatedEntryCount: number;
    revenue: number;
    expenses: number;
    netIncome: number;
    cashBalance: AccountBalance | null;
    bankBalance: AccountBalance | null;
  };

function canonicalAssetBalance(
  id: "cash" | "bank",
  accounts: readonly Account[],
  assets: readonly AccountBalance[],
): AccountBalance | null {
  const matches = accounts.filter((account) => account.id === id);
  if (matches.length !== 1 || matches[0].type !== "asset") return null;
  return assets.find(({ account }) => account.id === id) ?? null;
}

/** All posted session journals: P&L performance and cumulative asset balances use the same complete source. */
export function getDashboardAccountingReport(
  ledger: Pick<AccountingLedgerState, "journalEntries"> | null | undefined,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): DashboardAccountingReport {
  const profitLossReport = getProfitLossReport(ledger, {}, accounts);
  if (profitLossReport.status === "error") return profitLossReport;
  const balanceSheetReport = getBalanceSheetReport(ledger, undefined, accounts);
  if (balanceSheetReport.status === "error") return balanceSheetReport;
  if (profitLossReport.postedEntryCount === 0) return { status: "empty", currency: null, postedEntryCount: 0 };
  const currency = profitLossReport.currency;
  if (!currency || currency !== balanceSheetReport.currency) {
    return { status: "error", message: "The Dashboard requires a validated report currency." };
  }
  return {
    status: "ready",
    currency,
    postedEntryCount: profitLossReport.postedEntryCount,
    undatedEntryCount: profitLossReport.undatedEntryCount,
    revenue: profitLossReport.profitAndLoss.totalRevenue,
    expenses: profitLossReport.profitAndLoss.totalExpenses,
    netIncome: profitLossReport.profitAndLoss.netIncome,
    cashBalance: canonicalAssetBalance("cash", accounts, balanceSheetReport.balanceSheet.assets),
    bankBalance: canonicalAssetBalance("bank", accounts, balanceSheetReport.balanceSheet.assets),
  };
}
