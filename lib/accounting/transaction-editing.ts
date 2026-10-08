import { DEFAULT_CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import { appendTransactionAudit, type AuditContext } from "./audit-trail";
import { calculateLedgerTotals } from "./ledger";
import type { AccountingLedgerState } from "./transaction-posting";
import type { JournalTransaction } from "./transaction-workflow";
import type { Account, JournalEntry } from "./types";
import { assertValidJournalEntry, isValidCurrencyCode } from "./validation";

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

/** Validates an independent draft before replacing a proposal; never changes the ledger. */
export function editJournalTransaction(
  transaction: JournalTransaction,
  entry: JournalEntry,
  ledger: AccountingLedgerState,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
  auditContext?: AuditContext,
): JournalTransaction {
  if (transaction.status !== "awaiting_approval" && transaction.status !== "approved") {
    throw new Error(`Only unposted entries awaiting approval or approved can be edited; current status is ${transaction.status}.`);
  }
  const transactionId = transaction.suggestion.entry.id;
  if (ledger.journalEntries.some((posted) => posted.id === transactionId)) {
    throw new Error("Posted journal entries cannot be edited.");
  }
  if (!entry || typeof entry.id !== "string" || !entry.id.trim() || entry.id !== transactionId) {
    throw new Error("Editing must preserve the transaction ID.");
  }
  if (typeof entry.date !== "string" || !isCalendarDate(entry.date)) {
    throw new Error("Journal entry date must be a valid calendar date in YYYY-MM-DD format.");
  }
  if (typeof entry.description !== "string" || !entry.description.trim()) {
    throw new Error("Journal entry description is required.");
  }
  if (typeof entry.currency !== "string" || !Array.isArray(entry.lines) ||
      Array.from(entry.lines).some((line) => !line || typeof line !== "object" || typeof line.accountId !== "string")) {
    throw new Error("A journal entry requires a currency and valid account lines.");
  }
  if (entry.lines.some((line) => "currency" in line)) {
    throw new Error("Journal lines must use the single journal entry currency.");
  }

  // Copy all editable data so subsequent changes to the form cannot alter a saved entry.
  const candidate: JournalEntry = {
    id: transactionId,
    date: entry.date,
    description: entry.description,
    currency: entry.currency,
    lines: entry.lines.map(({ accountId, debit, credit }) => ({ accountId, debit, credit })),
  };
  assertValidJournalEntry(candidate, accounts);
  if (!isValidCurrencyCode(candidate.currency)) {
    throw new Error("Journal entry currency must be a three-letter uppercase currency code.");
  }
  if (candidate.lines.some((line) => line.debit === 0 && line.credit === 0)) {
    throw new Error("Each journal line must contain a positive debit or credit.");
  }
  // Core ledger validation enforces compatibility with entries already posted in this session.
  const totals = calculateLedgerTotals([...ledger.journalEntries, candidate], accounts);
  if (!Number.isFinite(totals.debitTotal) || !Number.isFinite(totals.creditTotal)) {
    throw new Error("Journal entry totals must be finite.");
  }
  return appendTransactionAudit(transaction, {
    ...transaction,
    status: "awaiting_approval",
    suggestion: { ...transaction.suggestion, entry: candidate },
  }, auditContext);
}
