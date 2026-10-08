import { DEFAULT_CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import { calculateAccountBalances, createTrialBalance } from "./ledger";
import { classifyBalanceSheet, classifyProfitAndLoss } from "./statements";
import { assertValidReversalForPosting, type JournalReversalReference } from "./transaction-reversal";
import type { JournalTransaction } from "./transaction-workflow";
import type { Account, AccountBalance, BalanceSheetClassification, JournalEntry, ProfitAndLossClassification, TrialBalance } from "./types";

/** Session-only ledger and snapshots derived entirely through the Accounting Core. */
export type AccountingLedgerState = {
  readonly journalEntries: readonly JournalEntry[];
  readonly balances: readonly AccountBalance[];
  readonly trialBalance: TrialBalance;
  readonly profitAndLoss: ProfitAndLossClassification;
  readonly balanceSheet: BalanceSheetClassification;
  /** Session-only reservations, including reversals still awaiting approval or posting. */
  readonly reversalReferences: readonly JournalReversalReference[];
};

export function createAccountingLedgerState(
  entries: readonly JournalEntry[] = [],
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): AccountingLedgerState {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id.trim()) throw new Error("A transaction ID is required for posting.");
    if (ids.has(entry.id)) throw new Error(`Transaction ${entry.id} has already been posted.`);
    ids.add(entry.id);
  }
  const journalEntries = [...entries];
  return {
    journalEntries,
    // These core functions validate entries and enforce the ledger's single-currency rule.
    balances: calculateAccountBalances(journalEntries, accounts),
    trialBalance: createTrialBalance(journalEntries, accounts),
    profitAndLoss: classifyProfitAndLoss(journalEntries, accounts),
    balanceSheet: classifyBalanceSheet(journalEntries, accounts),
    reversalReferences: [],
  };
}

/** Appends once and returns both state changes only after all core calculations succeed. */
export function postJournalTransaction(
  transaction: JournalTransaction,
  ledger: AccountingLedgerState,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): { transaction: JournalTransaction; ledger: AccountingLedgerState } {
  if (transaction.status !== "approved") {
    throw new Error(`Only approved transactions can be posted; current status is ${transaction.status}.`);
  }
  assertValidReversalForPosting(transaction, ledger, accounts);
  const nextLedger = {
    ...createAccountingLedgerState([...ledger.journalEntries, transaction.suggestion.entry], accounts),
    reversalReferences: ledger.reversalReferences,
  };
  return { transaction: { ...transaction, status: "posted" }, ledger: nextLedger };
}
