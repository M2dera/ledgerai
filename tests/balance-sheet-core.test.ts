import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { BALANCE_TOLERANCE } from "@/lib/accounting/ledger";
import { classifyBalanceSheet, classifyProfitAndLoss, createBalanceSheetStatement } from "@/lib/accounting/statements";
import type { Account, JournalEntry } from "@/lib/accounting/types";

const entries: JournalEntry[] = [
  { id: "capital", date: "2026-10-01", description: "Owner contribution", currency: "KWD", lines: [
    { accountId: "bank", debit: 1000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1000 },
  ] },
  { id: "sales", date: "2026-10-03", description: "Sales receipt", currency: "KWD", lines: [
    { accountId: "bank", debit: 2000, credit: 0 }, { accountId: "revenue", debit: 0, credit: 2000 },
  ] },
  { id: "rent", date: "2026-10-08", description: "Rent payment", currency: "KWD", lines: [
    { accountId: "rent-expense", debit: 600.125, credit: 0 }, { accountId: "bank", debit: 0, credit: 600.125 },
  ] },
  { id: "invoice", date: "2026-10-12", description: "Utilities invoice", currency: "KWD", lines: [
    { accountId: "utilities-expense", debit: 120, credit: 0 }, { accountId: "accounts-payable", debit: 0, credit: 120 },
  ] },
];

describe("Balance Sheet statement current earnings", () => {
  it("adds existing P&L earnings to disclosed equity while retaining classified account rows", () => {
    const classified = classifyBalanceSheet(entries, DEFAULT_CHART_OF_ACCOUNTS);
    const profitAndLoss = classifyProfitAndLoss(entries, DEFAULT_CHART_OF_ACCOUNTS);
    const statement = createBalanceSheetStatement(entries, DEFAULT_CHART_OF_ACCOUNTS);
    expect(classified.totalEquity).toBe(1000);
    expect(statement.assets).toEqual(classified.assets);
    expect(statement.liabilities).toEqual(classified.liabilities);
    expect(statement.equity).toEqual(classified.equity);
    expect(statement).toMatchObject({
      currency: "KWD", totalAssets: 2399.875, totalLiabilities: 120, totalAccountEquity: 1000,
      currentEarnings: 1279.875, totalEquity: 2279.875, totalLiabilitiesAndEquity: 2399.875,
      difference: 0, balanced: true, balanceTolerance: BALANCE_TOLERANCE,
    });
    expect(statement.currentEarnings).toBe(profitAndLoss.netIncome);
  });

  it("carries a loss as negative current earnings and reduces total equity", () => {
    const statement = createBalanceSheetStatement([entries[0], entries[2]], DEFAULT_CHART_OF_ACCOUNTS);
    expect(statement).toMatchObject({ totalAssets: 399.875, totalAccountEquity: 1000, currentEarnings: -600.125, totalEquity: 399.875, difference: 0, balanced: true });
    expect(statement.equity[0].balance).toBe(1000);
  });

  it("classifies assets, liabilities and equity by chart types even with misleading names", () => {
    const accounts: Account[] = [
      { id: "cash", code: "1000", name: "Rent Expense", type: "asset" },
      { id: "payable", code: "2000", name: "Service Revenue", type: "liability" },
      { id: "capital", code: "3000", name: "Computer Asset", type: "equity" },
      { id: "sales", code: "4000", name: "Equipment Asset", type: "revenue" },
      { id: "cost", code: "5000", name: "Accounts Payable", type: "expense" },
    ];
    const journals: JournalEntry[] = [
      { ...entries[0], lines: [{ accountId: "cash", debit: 100, credit: 0 }, { accountId: "capital", debit: 0, credit: 100 }] },
      { ...entries[1], lines: [{ accountId: "cash", debit: 80, credit: 0 }, { accountId: "sales", debit: 0, credit: 80 }] },
      { ...entries[2], lines: [{ accountId: "cost", debit: 20, credit: 0 }, { accountId: "cash", debit: 0, credit: 20 }] },
      { ...entries[3], lines: [{ accountId: "cost", debit: 5, credit: 0 }, { accountId: "payable", debit: 0, credit: 5 }] },
    ];
    const statement = createBalanceSheetStatement(journals, accounts);
    expect(statement.assets.map(({ account }) => account)).toEqual([accounts[0]]);
    expect(statement.liabilities.map(({ account }) => account)).toEqual([accounts[1]]);
    expect(statement.equity.map(({ account }) => account)).toEqual([accounts[2]]);
    expect(statement).toMatchObject({ totalAssets: 160, totalLiabilities: 5, totalAccountEquity: 100, currentEarnings: 55, totalEquity: 155, totalLiabilitiesAndEquity: 160, difference: 0, balanced: true });
  });

  it("keeps legitimate negative asset, liability and equity balances", () => {
    const journals: JournalEntry[] = [
      { ...entries[0], lines: [{ accountId: "owners-equity", debit: 40, credit: 0 }, { accountId: "bank", debit: 0, credit: 40 }] },
      { ...entries[1], lines: [{ accountId: "accounts-payable", debit: 25, credit: 0 }, { accountId: "bank", debit: 0, credit: 25 }] },
    ];
    const statement = createBalanceSheetStatement(journals, DEFAULT_CHART_OF_ACCOUNTS);
    expect(statement.assets.find(({ account }) => account.id === "bank")?.balance).toBe(-65);
    expect(statement.liabilities[0].balance).toBe(-25);
    expect(statement.equity[0].balance).toBe(-40);
    expect(statement).toMatchObject({ totalAssets: -65, totalLiabilities: -25, totalEquity: -40, currentEarnings: 0, difference: 0, balanced: true });
  });

  it("includes all zero-balance classified accounts in an empty statement without inventing currency", () => {
    const statement = createBalanceSheetStatement([], DEFAULT_CHART_OF_ACCOUNTS);
    expect(statement.assets.map(({ account }) => account)).toEqual(DEFAULT_CHART_OF_ACCOUNTS.filter(({ type }) => type === "asset"));
    expect(statement.liabilities.map(({ account }) => account)).toEqual(DEFAULT_CHART_OF_ACCOUNTS.filter(({ type }) => type === "liability"));
    expect(statement.equity.map(({ account }) => account)).toEqual(DEFAULT_CHART_OF_ACCOUNTS.filter(({ type }) => type === "equity"));
    expect([...statement.assets, ...statement.liabilities, ...statement.equity].every(({ balance }) => balance === 0)).toBe(true);
    expect(statement).toMatchObject({ currency: null, totalAssets: 0, totalLiabilities: 0, totalAccountEquity: 0, currentEarnings: 0, totalEquity: 0, totalLiabilitiesAndEquity: 0, difference: 0, balanced: true });
  });
});

describe("Balance Sheet equation tolerance", () => {
  function tinyImbalance(id: string, difference: number): JournalEntry {
    return { ...entries[0], id, lines: difference >= 0
      ? [{ accountId: "bank", debit: difference, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 0 }]
      : [{ accountId: "bank", debit: 0, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: -difference }],
    };
  }

  it.each([1, -1])("accepts the existing exact signed tolerance boundary %s and preserves raw balances", (sign) => {
    const difference = sign * BALANCE_TOLERANCE;
    const statement = createBalanceSheetStatement([tinyImbalance("boundary", difference)], DEFAULT_CHART_OF_ACCOUNTS);
    expect(statement).toMatchObject({ difference, balanced: true, balanceTolerance: BALANCE_TOLERANCE });
    if (sign > 0) expect(statement.assets.find(({ account }) => account.id === "bank")?.balance).toBe(BALANCE_TOLERANCE);
    else expect(statement.equity[0].balance).toBe(BALANCE_TOLERANCE);
  });

  it.each([1, -1])("labels accumulated individually permitted imbalance %s out of balance", (sign) => {
    const journals = [tinyImbalance("first", sign * BALANCE_TOLERANCE), tinyImbalance("second", sign * BALANCE_TOLERANCE)];
    const statement = createBalanceSheetStatement(journals, DEFAULT_CHART_OF_ACCOUNTS);
    expect(statement.difference).toBe(sign * 2 * BALANCE_TOLERANCE);
    expect(statement.balanced).toBe(false);
  });

  it("does not label nonfinite aggregates balanced", () => {
    const large = { ...entries[0], lines: [{ accountId: "bank", debit: 1e308, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1e308 }] };
    const statement = createBalanceSheetStatement([large, { ...large, id: "overflow" }], DEFAULT_CHART_OF_ACCOUNTS);
    expect(Number.isFinite(statement.totalAssets)).toBe(false);
    expect(Number.isFinite(statement.difference)).toBe(false);
    expect(statement.balanced).toBe(false);
  });
});
