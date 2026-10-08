import { DEFAULT_CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import { appendReversalCreationAudit, appendTransactionAudit, captureAuditContext, type AuditContext } from "./audit-trail";
import type { AccountingLedgerState } from "./transaction-posting";
import type { JournalTransaction } from "./transaction-workflow";
import type { Account, JournalEntry } from "./types";
import { assertValidJournalEntry, isValidCurrencyCode } from "./validation";

export type JournalReversalReference = {
  readonly originalTransactionId: string;
  readonly reversalTransactionId: string;
};

function validateReversalEntry(entry: JournalEntry, accounts: readonly Account[]): void {
  assertValidJournalEntry(entry, accounts);
  if (!isValidCurrencyCode(entry.currency)) {
    throw new Error("Journal entry currency must be a three-letter uppercase currency code.");
  }
  for (const line of entry.lines) {
    if (accounts.filter((account) => account.id === line.accountId).length !== 1) {
      throw new Error(`Journal account '${line.accountId}' must exist exactly once in the chart.`);
    }
  }
}

function postedOriginal(
  originalTransactionId: string,
  ledger: AccountingLedgerState,
  accounts: readonly Account[],
): JournalEntry {
  const matches = ledger.journalEntries.filter((entry) => entry.id === originalTransactionId);
  if (matches.length !== 1) throw new Error("The original transaction must exist exactly once in the posted ledger.");
  if (ledger.reversalReferences.some((reference) => reference.reversalTransactionId === originalTransactionId)) {
    throw new Error("A reversal transaction cannot itself be reversed.");
  }
  validateReversalEntry(matches[0], accounts);
  return matches[0];
}

function assertOriginalMatches(transaction: JournalTransaction, original: JournalEntry): void {
  const entry = transaction.suggestion.entry;
  if (entry.id !== original.id || entry.date !== original.date ||
      entry.description !== original.description || entry.currency !== original.currency ||
      entry.lines.length !== original.lines.length || entry.lines.some((line, index) => {
        const postedLine = original.lines[index];
        return line.accountId !== postedLine.accountId || line.debit !== postedLine.debit || line.credit !== postedLine.credit;
      })) {
    throw new Error("The original transaction must match its unchanged posted journal entry.");
  }
}

function assertExactReversal(entry: JournalEntry, original: JournalEntry, accounts: readonly Account[]): void {
  validateReversalEntry(entry, accounts);
  if (entry.currency !== original.currency || entry.lines.length !== original.lines.length ||
      entry.lines.some((line, index) => {
        const originalLine = original.lines[index];
        return line.accountId !== originalLine.accountId ||
          line.debit !== originalLine.credit || line.credit !== originalLine.debit;
      })) {
    throw new Error("A reversal must preserve the original currency, accounts, and amounts with every debit and credit swapped.");
  }
}

/** Creates a reviewable inverse and reserves its reference without changing any posted entry or balance. */
export function createJournalReversal(
  originalTransactionId: string,
  transactions: readonly JournalTransaction[],
  ledger: AccountingLedgerState,
  reversalTransactionId: string,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
  auditContext: AuditContext = captureAuditContext(),
): { transaction: JournalTransaction; ledger: AccountingLedgerState; originalTransaction: JournalTransaction } {
  const matches = transactions.filter((transaction) => transaction.suggestion.entry.id === originalTransactionId);
  if (matches.length !== 1) throw new Error("A single existing original transaction is required for reversal.");
  const originalTransaction = matches[0];
  if (originalTransaction.status !== "posted") {
    throw new Error(`Only posted transactions can be reversed; current status is ${originalTransaction.status}.`);
  }
  if (originalTransaction.reversalOfTransactionId !== undefined) {
    throw new Error("A reversal transaction cannot itself be reversed.");
  }
  if (originalTransaction.reversedByTransactionId !== undefined ||
      ledger.reversalReferences.some((reference) => reference.originalTransactionId === originalTransactionId) ||
      transactions.some((transaction) => transaction.reversalOfTransactionId === originalTransactionId)) {
    throw new Error("The original transaction already has a pending or completed reversal.");
  }
  const original = postedOriginal(originalTransactionId, ledger, accounts);
  assertOriginalMatches(originalTransaction, original);
  if (typeof reversalTransactionId !== "string" || !reversalTransactionId.trim()) {
    throw new Error("A new unique transaction ID is required for reversal.");
  }
  if (transactions.some((transaction) => transaction.suggestion.entry.id === reversalTransactionId) ||
      ledger.journalEntries.some((entry) => entry.id === reversalTransactionId) ||
      ledger.reversalReferences.some((reference) => reference.reversalTransactionId === reversalTransactionId)) {
    throw new Error("The reversal transaction ID is already in use.");
  }

  const entry: JournalEntry = {
    id: reversalTransactionId,
    date: original.date,
    description: `Reversal of ${original.id}: ${original.description}`,
    currency: original.currency,
    lines: original.lines.map(({ accountId, debit, credit }) => ({ accountId, debit: credit, credit: debit })),
  };
  assertExactReversal(entry, original, accounts);
  const transaction = appendTransactionAudit(undefined, {
    status: "awaiting_approval",
    reversalOfTransactionId: originalTransactionId,
    suggestion: { entry, intent: originalTransaction.suggestion.intent },
  }, auditContext);
  return {
    transaction,
    originalTransaction: appendReversalCreationAudit(originalTransaction, transaction, auditContext),
    ledger: {
      ...ledger,
      reversalReferences: [...ledger.reversalReferences, { originalTransactionId, reversalTransactionId }],
    },
  };
}

/** Posting must recheck both the reserved IDs and the exact inverse, including edited or stale copies. */
export function assertValidReversalForPosting(
  transaction: JournalTransaction,
  ledger: AccountingLedgerState,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): void {
  const entry = transaction.suggestion.entry;
  const references = ledger.reversalReferences.filter((reference) => reference.reversalTransactionId === entry.id);
  if (transaction.reversalOfTransactionId === undefined && references.length === 0) return;
  const reference = references[0];
  if (references.length !== 1 || !reference || reference.originalTransactionId !== transaction.reversalOfTransactionId ||
      reference.originalTransactionId === entry.id ||
      ledger.reversalReferences.filter((current) => current.originalTransactionId === reference.originalTransactionId).length !== 1) {
    throw new Error("The reversal must match its reserved original transaction reference.");
  }
  if (ledger.journalEntries.some((posted) => posted.id === reference.reversalTransactionId)) {
    throw new Error("The original transaction already has a completed reversal.");
  }
  const original = postedOriginal(reference.originalTransactionId, ledger, accounts);
  assertExactReversal(entry, original, accounts);
}

/** Only workflow metadata changes, after the reserved reversing entry has actually been posted. */
export function markJournalTransactionReversed(
  transaction: JournalTransaction,
  ledger: AccountingLedgerState,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
  auditContext?: AuditContext,
): JournalTransaction {
  if (transaction.status !== "posted" || transaction.reversalOfTransactionId !== undefined) {
    throw new Error("Only an original posted transaction can be marked reversed.");
  }
  const original = postedOriginal(transaction.suggestion.entry.id, ledger, accounts);
  assertOriginalMatches(transaction, original);
  const references = ledger.reversalReferences.filter((reference) => reference.originalTransactionId === original.id);
  const reversingEntry = ledger.journalEntries.find((entry) => entry.id === references[0]?.reversalTransactionId);
  if (references.length !== 1 || !reversingEntry) {
    throw new Error("The reversal must be successfully posted before marking the original reversed.");
  }
  assertExactReversal(reversingEntry, original, accounts);
  return appendTransactionAudit(transaction, { ...transaction, status: "reversed", reversedByTransactionId: reversingEntry.id }, auditContext);
}
