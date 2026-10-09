import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateAccountBalances, createTrialBalance } from "@/lib/accounting/ledger";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import type { JournalEntry, TrialBalance } from "@/lib/accounting/types";

export type TrialBalanceReport =
  | { status: "error"; message: string }
  | {
    status: "ready";
    trialBalance: TrialBalance;
    currency: string | null;
    postedEntryCount: number;
    includedEntryCount: number;
    asOfDate: string | null;
  };

function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function validatedTrialBalance(entries: readonly JournalEntry[]): TrialBalance {
  // Guard against overflowing account totals, which could otherwise disappear when NaN net balances map to zero.
  const balances = calculateAccountBalances(entries, DEFAULT_CHART_OF_ACCOUNTS);
  if (balances.some(({ debitTotal, creditTotal, balance }) =>
    !Number.isFinite(debitTotal) || !Number.isFinite(creditTotal) || !Number.isFinite(balance))) {
    throw new Error("Account balances are outside the supported numeric range.");
  }
  const trialBalance = createTrialBalance(entries, DEFAULT_CHART_OF_ACCOUNTS);
  if (!Number.isFinite(trialBalance.totalDebits) || !Number.isFinite(trialBalance.totalCredits) ||
      !Number.isFinite(trialBalance.difference) || trialBalance.lines.some(({ debitBalance, creditBalance }) =>
        !Number.isFinite(debitBalance) || !Number.isFinite(creditBalance))) {
    throw new Error("Trial Balance totals are outside the supported numeric range.");
  }
  return trialBalance;
}

/** Read-only current or cumulative as-of report from the existing posted journal source. */
export function getTrialBalanceReport(
  ledger: Pick<AccountingLedgerState, "journalEntries"> | null | undefined,
  asOfDate?: string,
): TrialBalanceReport {
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

    // Validate the complete source so a cutoff cannot hide invalid or mixed-currency posted data.
    const currentTrialBalance = validatedTrialBalance(entries);
    const selectedDate = asOfDate || null;
    if (selectedDate && !calendarDate(selectedDate)) throw new Error("Enter a valid as-of date in YYYY-MM-DD format.");
    if (selectedDate && entries.some((entry) => !calendarDate(entry.date))) {
      throw new Error("A posted entry has a missing or invalid journal date. Clear the as-of date to view current balances.");
    }

    // Include all earlier journals, with no lower date boundary, and preserve core posting-order summation.
    const includedEntries = selectedDate ? entries.filter((entry) => entry.date <= selectedDate) : entries;
    const trialBalance = selectedDate ? validatedTrialBalance(includedEntries) : currentTrialBalance;
    return {
      status: "ready",
      trialBalance,
      currency: currentTrialBalance.currency,
      postedEntryCount: entries.length,
      includedEntryCount: includedEntries.length,
      asOfDate: selectedDate,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The Trial Balance could not be generated safely." };
  }
}
