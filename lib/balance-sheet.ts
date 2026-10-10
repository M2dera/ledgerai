import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateAccountBalances, calculateLedgerTotals } from "@/lib/accounting/ledger";
import { createBalanceSheetStatement } from "@/lib/accounting/statements";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import type { Account, BalanceSheetStatement, JournalEntry } from "@/lib/accounting/types";

export type BalanceSheetReport =
  | { status: "error"; message: string }
  | {
    status: "ready";
    balanceSheet: BalanceSheetStatement;
    currency: string | null;
    postedEntryCount: number;
    includedEntryCount: number;
    asOfDate: string | null;
    undatedEntryCount: number;
  };

// Journal dates are metadata; posting validates accounting amounts, not calendar dates.
function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function validatedBalanceSheet(entries: readonly JournalEntry[], accounts: readonly Account[]): {
  balanceSheet: BalanceSheetStatement;
  currency: string | null;
} {
  const totals = calculateLedgerTotals(entries, accounts);
  const balances = calculateAccountBalances(entries, accounts);
  if (!Number.isFinite(totals.debitTotal) || !Number.isFinite(totals.creditTotal) ||
      balances.some(({ debitTotal, creditTotal, balance }) =>
        !Number.isFinite(debitTotal) || !Number.isFinite(creditTotal) || !Number.isFinite(balance))) {
    throw new Error("Account balances are outside the supported numeric range.");
  }
  const balanceSheet = createBalanceSheetStatement(entries, accounts);
  if (![balanceSheet.totalAssets, balanceSheet.totalLiabilities, balanceSheet.totalAccountEquity,
    balanceSheet.currentEarnings, balanceSheet.totalEquity, balanceSheet.totalLiabilitiesAndEquity,
    balanceSheet.difference].every(Number.isFinite)) {
    throw new Error("Balance Sheet totals are outside the supported numeric range.");
  }
  return { balanceSheet, currency: totals.currency };
}

/** Read-only cumulative statement from the shared posted journal source, calculated by the Accounting Core. */
export function getBalanceSheetReport(
  ledger: Pick<AccountingLedgerState, "journalEntries"> | null | undefined,
  asOfDate?: string,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): BalanceSheetReport {
  try {
    if (!ledger || !Array.isArray(ledger.journalEntries)) throw new Error("The session ledger is unavailable.");
    const entries: readonly JournalEntry[] = ledger.journalEntries;
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!entry || typeof entry.currency !== "string" || !Array.isArray(entry.lines) ||
          Array.from(entry.lines).some((line) => !line || typeof line.accountId !== "string")) {
        throw new Error("Posted journal data is incomplete.");
      }
      if (typeof entry.id !== "string" || !entry.id.trim()) throw new Error("A posted transaction is missing its ID.");
      if (ids.has(entry.id)) throw new Error("The posted ledger contains a duplicate transaction ID.");
      ids.add(entry.id);
    }

    // Validate the complete source first so a cutoff cannot hide invalid or mixed-currency data.
    const currentReport = validatedBalanceSheet(entries, accounts);
    const selectedDate = asOfDate || null;
    if (selectedDate && !calendarDate(selectedDate)) throw new Error("Enter a valid as-of date in YYYY-MM-DD format.");
    const undatedEntryCount = entries.filter((entry) => !calendarDate(entry.date)).length;
    if (selectedDate && undatedEntryCount) {
      throw new Error("A posted entry has a missing or invalid journal date. Clear the as-of date to view all posted balances.");
    }

    // Include all earlier whole journals in posting order; earnings use this exact same cumulative source.
    const includedEntries = selectedDate ? entries.filter((entry) => entry.date <= selectedDate) : entries;
    const { balanceSheet } = selectedDate ? validatedBalanceSheet(includedEntries, accounts) : currentReport;
    return {
      status: "ready",
      balanceSheet,
      currency: currentReport.currency,
      postedEntryCount: entries.length,
      includedEntryCount: includedEntries.length,
      asOfDate: selectedDate,
      undatedEntryCount,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The Balance Sheet could not be generated safely." };
  }
}
