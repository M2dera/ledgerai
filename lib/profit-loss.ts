import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateAccountBalances, calculateLedgerTotals } from "@/lib/accounting/ledger";
import { classifyProfitAndLoss } from "@/lib/accounting/statements";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import type { Account, JournalEntry, ProfitAndLossClassification } from "@/lib/accounting/types";

export type ProfitLossFilters = {
  startDate?: string;
  endDate?: string;
};

export type ProfitLossReport =
  | { status: "error"; message: string }
  | {
    status: "ready";
    profitAndLoss: ProfitAndLossClassification;
    currency: string | null;
    postedEntryCount: number;
    includedEntryCount: number;
    startDate: string | null;
    endDate: string | null;
    hasActivity: boolean;
    undatedEntryCount: number;
  };

// Journal dates are metadata; posting validates accounting amounts, not calendar dates.
function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function validatedProfitAndLoss(entries: readonly JournalEntry[], accounts: readonly Account[]): {
  profitAndLoss: ProfitAndLossClassification;
  currency: string | null;
} {
  const totals = calculateLedgerTotals(entries, accounts);
  const balances = calculateAccountBalances(entries, accounts);
  if (!Number.isFinite(totals.debitTotal) || !Number.isFinite(totals.creditTotal) ||
      balances.some(({ debitTotal, creditTotal, balance }) =>
        !Number.isFinite(debitTotal) || !Number.isFinite(creditTotal) || !Number.isFinite(balance))) {
    throw new Error("Account balances are outside the supported numeric range.");
  }
  const profitAndLoss = classifyProfitAndLoss(entries, accounts);
  if (!Number.isFinite(profitAndLoss.totalRevenue) || !Number.isFinite(profitAndLoss.totalExpenses) ||
      !Number.isFinite(profitAndLoss.netIncome)) {
    throw new Error("Profit & Loss totals are outside the supported numeric range.");
  }
  return { profitAndLoss, currency: totals.currency };
}

/** Read-only period report from the shared posted journal source, calculated by the Accounting Core. */
export function getProfitLossReport(
  ledger: Pick<AccountingLedgerState, "journalEntries"> | null | undefined,
  filters: ProfitLossFilters = {},
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): ProfitLossReport {
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

    // Validate the complete source first so period filters cannot hide invalid or mixed-currency data.
    const currentReport = validatedProfitAndLoss(entries, accounts);
    const startDate = filters.startDate || null;
    const endDate = filters.endDate || null;
    if ((startDate && !calendarDate(startDate)) || (endDate && !calendarDate(endDate))) {
      throw new Error("Enter valid dates in YYYY-MM-DD format.");
    }
    if (startDate && endDate && startDate > endDate) throw new Error("The start date must be on or before the end date.");
    const hasDateFilter = Boolean(startDate || endDate);
    const undatedEntryCount = entries.filter((entry) => !calendarDate(entry.date)).length;
    if (hasDateFilter && undatedEntryCount) {
      throw new Error("A posted entry has a missing or invalid journal date. Clear the date filters to view all posted activity.");
    }

    // Filter whole journals in their existing posting order, preserving the Core's money precision.
    const includedEntries = hasDateFilter
      ? entries.filter((entry) => (!startDate || entry.date >= startDate) && (!endDate || entry.date <= endDate))
      : entries;
    const { profitAndLoss } = hasDateFilter ? validatedProfitAndLoss(includedEntries, accounts) : currentReport;
    return {
      status: "ready",
      profitAndLoss,
      currency: currentReport.currency,
      postedEntryCount: entries.length,
      includedEntryCount: includedEntries.length,
      startDate,
      endDate,
      // Offset originals and reversals still represent activity even when their signed balances are zero.
      hasActivity: [...profitAndLoss.revenue, ...profitAndLoss.expenses].some(({ debitTotal, creditTotal }) =>
        debitTotal !== 0 || creditTotal !== 0),
      undatedEntryCount,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The Profit & Loss report could not be generated safely." };
  }
}
