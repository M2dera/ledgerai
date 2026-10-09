import { createAccountMap } from "./chart-of-accounts";
import type { Account, AccountBalance, JournalEntry, LedgerTotals, TrialBalance } from "./types";
import { assertValidJournalEntry } from "./validation";

const BALANCE_TOLERANCE = 1e-9;

export class MixedCurrencyLedgerError extends Error {
  constructor(readonly currencies: string[]) {
    super(`Ledger calculations require one currency; received ${currencies.join(", ")}.`);
    this.name = "MixedCurrencyLedgerError";
  }
}

function resolveCurrency(entries: readonly JournalEntry[]): string | null {
  const currencies = [...new Set(entries.map((entry) => entry.currency))];
  if (currencies.length > 1) throw new MixedCurrencyLedgerError(currencies);
  return currencies[0] ?? null;
}

function normalBalance(account: Account, debitTotal: number, creditTotal: number): number {
  return account.type === "asset" || account.type === "expense"
    ? debitTotal - creditTotal
    : creditTotal - debitTotal;
}

function validateLedger(entries: readonly JournalEntry[], accounts: readonly Account[]): string | null {
  entries.forEach((entry) => assertValidJournalEntry(entry, accounts));
  return resolveCurrency(entries);
}

function calculateValidatedAccountBalance(account: Account, entries: readonly JournalEntry[], currency: string | null): AccountBalance {
  let debitTotal = 0;
  let creditTotal = 0;

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountId !== account.id) continue;
      debitTotal += line.debit;
      creditTotal += line.credit;
    }
  }

  return { account, currency, debitTotal, creditTotal, balance: normalBalance(account, debitTotal, creditTotal) };
}

export function calculateAccountBalance(account: Account, entries: readonly JournalEntry[], accounts: readonly Account[]): AccountBalance {
  return calculateValidatedAccountBalance(account, entries, validateLedger(entries, accounts));
}

export function calculateAccountBalances(entries: readonly JournalEntry[], accounts: readonly Account[]): AccountBalance[] {
  const currency = validateLedger(entries, accounts);
  return accounts.map((account) => calculateValidatedAccountBalance(account, entries, currency));
}

export function calculateLedgerTotals(entries: readonly JournalEntry[], accounts: readonly Account[]): LedgerTotals {
  const currency = validateLedger(entries, accounts);
  return {
    currency,
    debitTotal: entries.reduce((entryTotal, entry) => entryTotal + entry.lines.reduce((lineTotal, line) => lineTotal + line.debit, 0), 0),
    creditTotal: entries.reduce((entryTotal, entry) => entryTotal + entry.lines.reduce((lineTotal, line) => lineTotal + line.credit, 0), 0),
  };
}

export function createTrialBalance(entries: readonly JournalEntry[], accounts: readonly Account[]): TrialBalance {
  const currency = resolveCurrency(entries);
  const balances = calculateAccountBalances(entries, accounts);
  const lines = balances.map(({ account, debitTotal, creditTotal }) => {
    const netDebit = debitTotal - creditTotal;
    return {
      account,
      debitBalance: netDebit > BALANCE_TOLERANCE ? netDebit : 0,
      creditBalance: netDebit < -BALANCE_TOLERANCE ? -netDebit : 0,
    };
  });
  const totalDebits = lines.reduce((total, line) => total + line.debitBalance, 0);
  const totalCredits = lines.reduce((total, line) => total + line.creditBalance, 0);
  const difference = totalDebits - totalCredits;
  return { currency, lines, totalDebits, totalCredits, difference, balanced: Math.abs(difference) <= BALANCE_TOLERANCE };
}

export function getAccount(entries: readonly JournalEntry[], accounts: readonly Account[], accountId: string): AccountBalance | null {
  const account = createAccountMap(accounts).get(accountId);
  return account ? calculateAccountBalance(account, entries, accounts) : null;
}
