import { DEFAULT_CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import { appendTransactionAudit, captureAuditContext, type AuditContext, type TransactionAuditEvent } from "./audit-trail";
import type { SuggestedJournalEntry } from "./suggested-journal-entry";
import type { Account } from "./types";
import { assertValidJournalEntry } from "./validation";

export type JournalTransactionStatus = "draft" | "awaiting_approval" | "approved" | "posted" | "reversed";

/** Transient workflow metadata around an existing accounting proposal. */
export type JournalTransaction = {
  readonly status: JournalTransactionStatus;
  readonly suggestion: SuggestedJournalEntry;
  readonly reversalOfTransactionId?: string;
  readonly reversedByTransactionId?: string;
  readonly auditEvents?: readonly TransactionAuditEvent[];
};

export function createDraftTransaction(suggestion: SuggestedJournalEntry, auditContext?: AuditContext): JournalTransaction {
  return appendTransactionAudit(undefined, { status: "draft", suggestion }, auditContext);
}

/** The suggestion engine has already validated this proposal for review. */
export function createSuggestedTransaction(suggestion: SuggestedJournalEntry, auditContext: AuditContext = captureAuditContext()): JournalTransaction {
  const draft = createDraftTransaction(suggestion, auditContext);
  // Creation and submission are one successful action with the same captured timestamp.
  return appendTransactionAudit(draft, { ...draft, status: "awaiting_approval" }, auditContext);
}

/** Review/approval only. Posting requires the ledger-aware postJournalTransaction function. */
export function transitionJournalTransaction(
  transaction: JournalTransaction,
  nextStatus: JournalTransactionStatus,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
  auditContext?: AuditContext,
): JournalTransaction {
  const allowed = (transaction.status === "draft" && nextStatus === "awaiting_approval") ||
    (transaction.status === "awaiting_approval" && nextStatus === "approved");
  if (!allowed) throw new Error(`Cannot transition a transaction from ${transaction.status} to ${nextStatus}.`);

  assertValidJournalEntry(transaction.suggestion.entry, accounts);
  return appendTransactionAudit(transaction, { ...transaction, status: nextStatus }, auditContext);
}
