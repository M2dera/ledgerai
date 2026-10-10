import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateLedgerTotals, createTrialBalance } from "@/lib/accounting/ledger";
import type { JournalEntry } from "@/lib/accounting/types";
import { validateJournalEntry } from "@/lib/accounting/validation";

const accounts = DEFAULT_CHART_OF_ACCOUNTS;

function entry(lines: JournalEntry["lines"], id = "trial-core-1"): JournalEntry {
  return { id, date: "2026-10-09", description: "Trial Balance core fixture", currency: "KWD", lines };
}

describe("Accounting Core Trial Balance difference", () => {
  it("derives the difference from net account balances, preserving the distinction from gross journal totals", () => {
    const entries = [
      entry([{ accountId: "bank", debit: 1000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1000 }]),
      entry([{ accountId: "rent-expense", debit: 600.125, credit: 0 }, { accountId: "bank", debit: 0, credit: 600.125 }], "trial-core-2"),
    ];
    const trialBalance = createTrialBalance(entries, accounts);
    expect(calculateLedgerTotals(entries, accounts)).toMatchObject({ debitTotal: 1600.125, creditTotal: 1600.125 });
    expect(trialBalance).toMatchObject({ currency: "KWD", totalDebits: 1000, totalCredits: 1000, difference: 0, balanced: true });
    expect(trialBalance.difference).toBe(trialBalance.totalDebits - trialBalance.totalCredits);
  });

  it.each([false, true])("reports signed net imbalance despite equal gross journals, reversed directions: %s", (reverse) => {
    const lines = [
      { accountId: "bank", debit: 2e-9, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: 1e-9 },
      { accountId: "revenue", debit: 0, credit: 1e-9 },
    ].map(({ accountId, debit, credit }) => reverse ? { accountId, debit: credit, credit: debit } : { accountId, debit, credit });
    const entries = [entry(lines)];
    expect(validateJournalEntry(entries[0], accounts).valid).toBe(true);
    expect(calculateLedgerTotals(entries, accounts)).toEqual({ currency: "KWD", debitTotal: 2e-9, creditTotal: 2e-9 });

    const trialBalance = createTrialBalance(entries, accounts);
    expect(trialBalance).toMatchObject({
      totalDebits: reverse ? 0 : 2e-9,
      totalCredits: reverse ? 2e-9 : 0,
      difference: reverse ? -2e-9 : 2e-9,
      balanced: false,
    });
    expect(trialBalance.lines.find(({ account }) => account.id === "owners-equity")).toMatchObject({ debitBalance: 0, creditBalance: 0 });
    expect(trialBalance.lines.find(({ account }) => account.id === "revenue")).toMatchObject({ debitBalance: 0, creditBalance: 0 });
  });

  it.each([false, true])("retains the inclusive existing balance tolerance without discarding a nonzero difference, reversed directions: %s", (reverse) => {
    // These represented values subtract to exactly 1e-9; both account balances exceed the line threshold.
    const debit = reverse ? 1.02e-9 : 2.02e-9;
    const credit = reverse ? 2.02e-9 : 1.02e-9;
    const candidate = entry([{ accountId: "bank", debit, credit: 0 }, { accountId: "owners-equity", debit: 0, credit }]);
    expect(validateJournalEntry(candidate, accounts).valid).toBe(true);
    const trialBalance = createTrialBalance([candidate], accounts);
    expect(trialBalance.difference).toBe(reverse ? -1e-9 : 1e-9);
    expect(trialBalance.balanced).toBe(true);
  });

  it.each([
    [1e-9, 0],
    [1.000000001e-9, 1.000000001e-9],
  ])("retains the existing net-line threshold for amount %s", (amount, displayed) => {
    const trialBalance = createTrialBalance([entry([
      { accountId: "bank", debit: amount, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: amount },
    ])], accounts);
    expect(trialBalance).toMatchObject({ totalDebits: displayed, totalCredits: displayed, difference: 0, balanced: true });
    expect(trialBalance.lines.find(({ account }) => account.id === "bank")?.debitBalance).toBe(displayed);
    expect(trialBalance.lines.find(({ account }) => account.id === "owners-equity")?.creditBalance).toBe(displayed);
  });

  it("retains all zero-balance accounts for an empty ledger and does not infer currency", () => {
    const trialBalance = createTrialBalance([], accounts);
    expect(trialBalance).toMatchObject({ currency: null, totalDebits: 0, totalCredits: 0, difference: 0, balanced: true });
    expect(trialBalance.lines.map(({ account }) => account)).toEqual(accounts);
    expect(trialBalance.lines.every(({ debitBalance, creditBalance }) => debitBalance === 0 && creditBalance === 0)).toBe(true);
    expect(createTrialBalance([], [])).toEqual({ currency: null, lines: [], totalDebits: 0, totalCredits: 0, difference: 0, balanced: true });
  });

  it("adds the difference without changing existing account accumulation or precision", () => {
    const entries = [1_000_000_000, 0.001, 0.001].map((amount, index) => entry([
      { accountId: "bank", debit: amount, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: amount },
    ], `precision-${index}`));
    const trialBalance = createTrialBalance(entries, accounts);
    expect(trialBalance).toMatchObject({ totalDebits: 1_000_000_000.0020001, totalCredits: 1_000_000_000.0020001, difference: 0, balanced: true });
  });

  it("preserves the existing overflow contract and never labels a nonfinite difference balanced", () => {
    const entries = ["overflow-1", "overflow-2"].map((id) => entry([
      { accountId: "bank", debit: 1e308, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: 1e308 },
    ], id));
    const trialBalance = createTrialBalance(entries, accounts);
    expect(trialBalance.totalDebits).toBe(Infinity);
    expect(trialBalance.totalCredits).toBe(Infinity);
    expect(trialBalance.difference).toBeNaN();
    expect(trialBalance.balanced).toBe(false);
  });
});
