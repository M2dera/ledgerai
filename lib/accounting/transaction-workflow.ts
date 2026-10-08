import { DEFAULT_CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import type { SuggestedJournalEntry } from "./suggested-journal-entry";
import type { Account } from "./types";
import { assertValidJournalEntry } from "./validation";

export type JournalTransactionStatus = "draft" | "awaiting_approval" | "approved" | "posted";

/** Transient workflow metadata around an existing accounting proposal. */
export type JournalTransaction = {
  readonly status: JournalTransactionStatus;
  readonly suggestion: SuggestedJournalEntry;
};

export function createDraftTransaction(suggestion: SuggestedJournalEntry): JournalTransaction {
  return { status: "draft", suggestion };
}

/** The suggestion engine has already validated this proposal for review. */
export function createSuggestedTransaction(suggestion: SuggestedJournalEntry): JournalTransaction {
  return { status: "awaiting_approval", suggestion };
}

/** Review/approval only. Posting requires the ledger-aware postJournalTransaction function. */
export function transitionJournalTransaction(
  transaction: JournalTransaction,
  nextStatus: JournalTransactionStatus,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): JournalTransaction {
  const allowed = (transaction.status === "draft" && nextStatus === "awaiting_approval") ||
    (transaction.status === "awaiting_approval" && nextStatus === "approved");
  if (!allowed) throw new Error(`Cannot transition a transaction from ${transaction.status} to ${nextStatus}.`);

  assertValidJournalEntry(transaction.suggestion.entry, accounts);
  return { ...transaction, status: nextStatus };
}
