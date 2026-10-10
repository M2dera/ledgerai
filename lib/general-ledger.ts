import { createAccountMap, DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateAccountBalance, calculateLedgerTotals } from "@/lib/accounting/ledger";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import type { Account, AccountBalance, JournalEntry, LedgerTotals } from "@/lib/accounting/types";

export type GeneralLedgerFilters = {
  accountId?: string;
  startDate?: string;
  endDate?: string;
};

export type GeneralLedgerRow = {
  key: string;
  transactionId: string;
  date: string | null;
  description: string;
  account: Account;
  debit: number;
  credit: number;
};

export type GeneralLedgerView =
  | { status: "error"; message: string }
  | {
    status: "ready";
    rows: GeneralLedgerRow[];
    currency: string | null;
    totals: LedgerTotals;
    selectedAccountBalance: AccountBalance | null;
    postedEntryCount: number;
    undatedEntryCount: number;
    hasDateFilter: boolean;
  };

// Dates are presentation metadata; the Accounting Core does not validate them on posting.
function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function assertFiniteTotals(totals: LedgerTotals): void {
  if (!Number.isFinite(totals.debitTotal) || !Number.isFinite(totals.creditTotal)) {
    throw new Error("Ledger totals are outside the supported numeric range.");
  }
}

/** Read-only presentation of posted journals. All amounts and balances come from the Accounting Core. */
export function getGeneralLedgerView(
  ledger: Pick<AccountingLedgerState, "journalEntries"> | null | undefined,
  filters: GeneralLedgerFilters = {},
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): GeneralLedgerView {
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

    // Validate the entire source before filtering so invalid or mixed-currency entries cannot be hidden.
    const sourceTotals = calculateLedgerTotals(entries, accounts);
    assertFiniteTotals(sourceTotals);

    const accountMap = createAccountMap(accounts);
    const selectedAccount = filters.accountId ? accountMap.get(filters.accountId) : undefined;
    if (filters.accountId && !selectedAccount) throw new Error("Select an account from the Chart of Accounts.");
    const startDate = filters.startDate || undefined;
    const endDate = filters.endDate || undefined;
    if ((startDate && !calendarDate(startDate)) || (endDate && !calendarDate(endDate))) {
      throw new Error("Enter valid dates in YYYY-MM-DD format.");
    }
    if (startDate && endDate && startDate > endDate) throw new Error("The start date must be on or before the end date.");
    const hasDateFilter = Boolean(startDate || endDate);

    const datedEntries = entries.map((entry, index) => ({ entry, index, date: calendarDate(entry.date) }));
    const periodEntries = datedEntries
      .filter(({ date }) => !hasDateFilter || (date !== null && (!startDate || date >= startDate) && (!endDate || date <= endDate)));
    const journals = periodEntries.map(({ entry }) => entry);

    // Keep complete journals in posting order so floating-point sums match the session snapshots exactly.
    const totals = calculateLedgerTotals(journals, accounts);
    assertFiniteTotals(totals);
    const selectedAccountBalance = selectedAccount ? calculateAccountBalance(selectedAccount, journals, accounts) : null;
    if (selectedAccountBalance && !Number.isFinite(selectedAccountBalance.balance)) {
      throw new Error("The account balance is outside the supported numeric range.");
    }
    // Sort only a fresh presentation list; equal dates retain posting order and unavailable dates remain visible.
    const sortedEntries = [...periodEntries].sort((left, right) =>
      (left.date ?? "9999-99-99").localeCompare(right.date ?? "9999-99-99") || left.index - right.index);
    const rows = sortedEntries.flatMap(({ entry, date }) => entry.lines.flatMap((line, lineIndex) => {
      if (selectedAccount && line.accountId !== selectedAccount.id) return [];
      const account = accountMap.get(line.accountId);
      if (!account) throw new Error("A posted line references an unavailable account.");
      return [{
        key: `${entry.id}:${lineIndex}`,
        transactionId: entry.id,
        date,
        description: typeof entry.description === "string" && entry.description.trim() ? entry.description : "No description",
        account,
        debit: line.debit,
        credit: line.credit,
      }];
    }));

    return {
      status: "ready",
      rows,
      currency: sourceTotals.currency,
      totals,
      selectedAccountBalance,
      postedEntryCount: entries.length,
      undatedEntryCount: datedEntries.filter(({ date }) => date === null).length,
      hasDateFilter,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The posted ledger could not be read safely." };
  }
}
