import { describe, expect, it } from "vitest";
import {
  calculateAccountBalance,
  calculateLedgerTotals,
  classifyBalanceSheet,
  classifyProfitAndLoss,
  createTrialBalance,
  DEFAULT_CHART_OF_ACCOUNTS,
  InvalidJournalEntryError,
  MixedCurrencyLedgerError,
  validateJournalEntry,
  type JournalEntry,
} from "@/lib/accounting";

const accounts = DEFAULT_CHART_OF_ACCOUNTS;

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "entry-1",
    date: "2026-01-01",
    description: "Owner contribution",
    currency: "KWD",
    lines: [
      { accountId: "bank", debit: 10_000, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: 10_000 },
    ],
    ...overrides,
  };
}

const ledgerEntries: JournalEntry[] = [
  entry(),
  entry({
    id: "entry-2",
    date: "2026-01-10",
    description: "Cash sale",
    lines: [
      { accountId: "bank", debit: 5_000, credit: 0 },
      { accountId: "revenue", debit: 0, credit: 5_000 },
    ],
  }),
  entry({
    id: "entry-3",
    date: "2026-01-15",
    description: "Rent payment",
    lines: [
      { accountId: "rent-expense", debit: 1_000, credit: 0 },
      { accountId: "bank", debit: 0, credit: 1_000 },
    ],
  }),
];

describe("accounting core", () => {
  it("accepts a valid balanced journal entry", () => {
    expect(validateJournalEntry(entry(), accounts)).toEqual({ valid: true, errors: [] });
  });

  it("rejects an unbalanced journal entry with a typed error", () => {
    const result = validateJournalEntry(entry({ lines: [
      { accountId: "bank", debit: 100, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: 90 },
    ] }), accounts);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNBALANCED_ENTRY" }));
  });

  it("rejects negative amounts", () => {
    const result = validateJournalEntry(entry({ lines: [
      { accountId: "bank", debit: -100, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: -100 },
    ] }), accounts);
    expect(result.valid).toBe(false);
    expect(result.errors.filter((error) => error.code === "NEGATIVE_AMOUNT")).toHaveLength(2);
  });

  it("rejects references to accounts outside the chart", () => {
    const result = validateJournalEntry(entry({ lines: [
      { accountId: "missing-account", debit: 100, credit: 0 },
      { accountId: "bank", debit: 0, credit: 100 },
    ] }), accounts);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "ACCOUNT_NOT_FOUND", accountId: "missing-account", lineIndex: 0 }));
  });

  it("rejects a line containing both debit and credit", () => {
    const result = validateJournalEntry(entry({ lines: [
      { accountId: "bank", debit: 100, credit: 50 },
      { accountId: "owners-equity", debit: 0, credit: 50 },
    ] }), accounts);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "SIMULTANEOUS_DEBIT_CREDIT", lineIndex: 0 }));
  });

  it("requires at least two lines and a valid currency", () => {
    const result = validateJournalEntry(entry({ currency: "kd", lines: [{ accountId: "bank", debit: 0, credit: 0 }] }), accounts);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["INVALID_CURRENCY", "INSUFFICIENT_LINES"]));
  });

  it("calculates debit, credit, and normal account balances", () => {
    const bank = accounts.find((account) => account.id === "bank")!;
    const revenue = accounts.find((account) => account.id === "revenue")!;
    const bankBalance = calculateAccountBalance(bank, ledgerEntries, accounts);
    const revenueBalance = calculateAccountBalance(revenue, ledgerEntries, accounts);

    expect(bankBalance).toMatchObject({ currency: "KWD", debitTotal: 15_000, creditTotal: 1_000, balance: 14_000 });
    expect(revenueBalance).toMatchObject({ currency: "KWD", debitTotal: 0, creditTotal: 5_000, balance: 5_000 });
    expect(calculateLedgerTotals(ledgerEntries, accounts)).toEqual({ currency: "KWD", debitTotal: 16_000, creditTotal: 16_000 });
  });

  it("produces a balanced trial balance", () => {
    const trialBalance = createTrialBalance(ledgerEntries, accounts);
    expect(trialBalance).toMatchObject({ currency: "KWD", totalDebits: 15_000, totalCredits: 15_000, balanced: true });
    expect(trialBalance.lines.find((line) => line.account.id === "bank")).toMatchObject({ debitBalance: 14_000, creditBalance: 0 });
    expect(trialBalance.lines.find((line) => line.account.id === "revenue")).toMatchObject({ debitBalance: 0, creditBalance: 5_000 });
  });

  it("classifies revenue and expense accounts for a basic Profit & Loss foundation", () => {
    const result = classifyProfitAndLoss(ledgerEntries, accounts);
    expect(result.revenue.map(({ account }) => account.id)).toEqual(["revenue"]);
    expect(result.expenses.map(({ account }) => account.id)).toEqual(["rent-expense", "salaries-expense", "utilities-expense"]);
    expect(result).toMatchObject({ currency: "KWD", totalRevenue: 5_000, totalExpenses: 1_000, netIncome: 4_000 });
  });

  it("classifies asset, liability, and equity accounts for a basic Balance Sheet foundation", () => {
    const result = classifyBalanceSheet(ledgerEntries, accounts);
    expect(result.assets.map(({ account }) => account.type)).toEqual(["asset", "asset", "asset"]);
    expect(result.liabilities.map(({ account }) => account.id)).toEqual(["accounts-payable"]);
    expect(result.equity.map(({ account }) => account.id)).toEqual(["owners-equity"]);
    expect(result).toMatchObject({ currency: "KWD", totalAssets: 14_000, totalLiabilities: 0, totalEquity: 10_000 });
  });

  it("rejects invalid entries and mixed currencies at ledger calculation boundaries", () => {
    const bank = accounts.find((account) => account.id === "bank")!;
    expect(() => calculateAccountBalance(bank, [entry({ lines: [] })], accounts)).toThrow(InvalidJournalEntryError);
    expect(() => calculateAccountBalance(bank, [entry(), entry({ id: "usd", currency: "USD" })], accounts)).toThrow(MixedCurrencyLedgerError);
  });
});
