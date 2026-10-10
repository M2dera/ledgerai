import type { Account, JournalEntry, JournalEntryValidationError, JournalEntryValidationResult } from "./types";

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const BALANCE_TOLERANCE = 1e-9;

export class InvalidJournalEntryError extends Error {
  readonly errors: JournalEntryValidationError[];

  constructor(errors: JournalEntryValidationError[]) {
    super(errors.map((error) => error.message).join(" "));
    this.name = "InvalidJournalEntryError";
    this.errors = errors;
  }
}

export function isValidCurrencyCode(currency: string): boolean {
  return CURRENCY_CODE_PATTERN.test(currency);
}

export function validateJournalEntry(entry: JournalEntry, accounts: readonly Account[]): JournalEntryValidationResult {
  const errors: JournalEntryValidationError[] = [];
  const accountIds = new Set(accounts.map((account) => account.id));
  const currency = entry.currency.trim();

  if (!currency) {
    errors.push({ code: "MISSING_CURRENCY", message: "Journal entry currency is required." });
  } else if (!isValidCurrencyCode(currency)) {
    errors.push({ code: "INVALID_CURRENCY", message: "Journal entry currency must be a three-letter uppercase currency code." });
  }

  if (entry.lines.length < 2) {
    errors.push({ code: "INSUFFICIENT_LINES", message: "A journal entry must contain at least two lines." });
  }

  entry.lines.forEach((line, lineIndex) => {
    if (!Number.isFinite(line.debit) || !Number.isFinite(line.credit)) {
      errors.push({ code: "INVALID_AMOUNT", message: `Line ${lineIndex + 1} contains a non-finite debit or credit amount.`, lineIndex });
    } else {
      if (line.debit < 0 || line.credit < 0) {
        errors.push({ code: "NEGATIVE_AMOUNT", message: `Line ${lineIndex + 1} contains a negative debit or credit amount.`, lineIndex });
      }
      if (line.debit > 0 && line.credit > 0) {
        errors.push({ code: "SIMULTANEOUS_DEBIT_CREDIT", message: `Line ${lineIndex + 1} cannot contain both a debit and a credit.`, lineIndex });
      }
    }

    if (!accountIds.has(line.accountId)) {
      errors.push({ code: "ACCOUNT_NOT_FOUND", message: `Line ${lineIndex + 1} references unknown account '${line.accountId}'.`, lineIndex, accountId: line.accountId });
    }
  });

  const debitTotal = entry.lines.reduce((total, line) => total + (Number.isFinite(line.debit) ? line.debit : 0), 0);
  const creditTotal = entry.lines.reduce((total, line) => total + (Number.isFinite(line.credit) ? line.credit : 0), 0);
  if (Math.abs(debitTotal - creditTotal) > BALANCE_TOLERANCE) {
    errors.push({ code: "UNBALANCED_ENTRY", message: `Journal entry debits (${debitTotal}) must equal credits (${creditTotal}).` });
  }

  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

export function assertValidJournalEntry(entry: JournalEntry, accounts: readonly Account[]): void {
  const result = validateJournalEntry(entry, accounts);
  if (!result.valid) throw new InvalidJournalEntryError(result.errors);
}
