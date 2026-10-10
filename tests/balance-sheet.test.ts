import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { BALANCE_TOLERANCE } from "@/lib/accounting/ledger";
import { classifyProfitAndLoss, createBalanceSheetStatement } from "@/lib/accounting/statements";
import { createAccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import type { Account, JournalEntry } from "@/lib/accounting/types";
import { approveChatTransaction, createChatState, editChatTransaction, postChatTransaction, reverseChatTransaction, type ChatState } from "@/lib/chat";
import { getBalanceSheetReport } from "@/lib/balance-sheet";

afterEach(() => vi.unstubAllGlobals());

function ready(
  ledger: Parameters<typeof getBalanceSheetReport>[0],
  asOfDate?: string,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
) {
  const report = getBalanceSheetReport(ledger, asOfDate, accounts);
  if (report.status !== "ready") throw new Error(report.message);
  return report;
}

function stateFor(status: JournalTransactionStatus = "awaiting_approval", kind: "rent" | "sales" = "rent"): ChatState {
  const parsed = parseTransactionIntent(kind === "rent"
    ? "paid rent 600.125 KWD from bank"
    : "received 2,000 KWD from the customer for services into bank");
  if (parsed.status !== "resolved") throw new Error("Expected a resolved transaction.");
  const suggestion = suggestJournalEntry(parsed.intent, { id: `sheet-${kind}`, date: "2026-10-08" });
  if (suggestion.status !== "suggested") throw new Error("Expected a suggestion.");
  return createChatState([{ sender: "ai", text: "Transaction suggestion", transaction: { ...createSuggestedTransaction(suggestion.suggestion), status } }]);
}

function approveAndPost(state: ChatState, id = "sheet-rent") {
  return postChatTransaction({ ...state, messages: approveChatTransaction(state.messages, id) }, id);
}

function freezeRecursively(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

const entries: JournalEntry[] = [
  { id: "rent", date: "2026-10-08", description: "Rent payment", currency: "KWD", lines: [
    { accountId: "rent-expense", debit: 600.125, credit: 0 }, { accountId: "bank", debit: 0, credit: 600.125 },
  ] },
  { id: "capital", date: "2026-10-01", description: "Owner contribution", currency: "KWD", lines: [
    { accountId: "bank", debit: 1000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1000 },
  ] },
  { id: "sales", date: "2026-10-03", description: "Sales receipt", currency: "KWD", lines: [
    { accountId: "bank", debit: 2000, credit: 0 }, { accountId: "revenue", debit: 0, credit: 2000 },
  ] },
  { id: "utilities", date: "2026-10-12", description: "Unpaid utilities", currency: "KWD", lines: [
    { accountId: "utilities-expense", debit: 120, credit: 0 }, { accountId: "accounts-payable", debit: 0, credit: 120 },
  ] },
  { id: "equipment", date: "2026-10-10", description: "Computer equipment", currency: "KWD", lines: [
    { accountId: "computer-equipment", debit: 500, credit: 0 }, { accountId: "bank", debit: 0, credit: 500 },
  ] },
];

describe("Balance Sheet posted source", () => {
  it("returns Core account balances and transparently adds current earnings to equity", () => {
    const ledger = createAccountingLedgerState(entries);
    const report = ready(ledger);
    expect(report.balanceSheet).toEqual(createBalanceSheetStatement(entries, DEFAULT_CHART_OF_ACCOUNTS));
    expect(report).toMatchObject({ currency: "KWD", postedEntryCount: 5, includedEntryCount: 5, asOfDate: null, undatedEntryCount: 0 });
    expect(report.balanceSheet).toMatchObject({ totalAssets: 2399.875, totalLiabilities: 120, totalAccountEquity: 1000, currentEarnings: 1279.875, totalEquity: 2279.875, totalLiabilitiesAndEquity: 2399.875, difference: 0, balanced: true });
    expect(report.balanceSheet.assets.find(({ account }) => account.id === "bank")?.balance).toBe(1899.875);
    expect(report.balanceSheet.assets.find(({ account }) => account.id === "computer-equipment")?.balance).toBe(500);
    expect(report.balanceSheet.equity).toEqual(ledger.balanceSheet.equity);
    expect(report.balanceSheet.currentEarnings).toBe(ledger.profitAndLoss.netIncome);
  });

  it("recalculates from posted journals instead of trusting stale derived session snapshots", () => {
    const ledger = createAccountingLedgerState(entries);
    const stale = { ...ledger, balanceSheet: { ...ledger.balanceSheet, totalAssets: 999, totalEquity: 999 }, profitAndLoss: { ...ledger.profitAndLoss, netIncome: 999 } };
    expect(ready(stale).balanceSheet).toEqual(ready(ledger).balanceSheet);
  });

  it.each(["draft", "awaiting_approval", "approved"] as const)("excludes %s transactions through the real session posted source", (status) => {
    const unposted = stateFor(status);
    expect(ready(unposted.ledger)).toMatchObject({ includedEntryCount: 0, balanceSheet: { totalAssets: 0, totalEquity: 0, currentEarnings: 0, balanced: true } });
    const posted = approveAndPost(stateFor("awaiting_approval", "sales"), "sheet-sales");
    const withUnposted = { ...posted, messages: [...posted.messages, ...unposted.messages] };
    expect(ready(withUnposted.ledger).balanceSheet).toEqual(ready(posted.ledger).balanceSheet);
    expect(ready(withUnposted.ledger)).toMatchObject({ includedEntryCount: 1, balanceSheet: { totalAssets: 2000, totalAccountEquity: 0, currentEarnings: 2000, totalEquity: 2000, balanced: true } });
  });

  it.each(["rent", "sales"] as const)("excludes an unposted %s reversal and offsets both sides after posting", (kind) => {
    const id = `sheet-${kind}`;
    const original = approveAndPost(stateFor("awaiting_approval", kind), id);
    const pending = reverseChatTransaction(original, id, "sheet-reversal");
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, "sheet-reversal") };
    for (const state of [pending, approved]) {
      expect(ready(state.ledger).balanceSheet).toEqual(ready(original.ledger).balanceSheet);
      expect(ready(state.ledger).includedEntryCount).toBe(1);
    }
    const posted = postChatTransaction(approved, "sheet-reversal");
    const report = ready(posted.ledger);
    expect(report).toMatchObject({ includedEntryCount: 2, balanceSheet: { totalAssets: 0, totalLiabilities: 0, totalAccountEquity: 0, currentEarnings: 0, totalEquity: 0, totalLiabilitiesAndEquity: 0, difference: 0, balanced: true } });
    expect(posted.ledger.journalEntries[0]).toBe(original.ledger.journalEntries[0]);
    expect(posted.ledger.journalEntries.map(({ id: transactionId }) => transactionId)).toEqual([id, "sheet-reversal"]);
  });

  it("preserves negative balances and current losses in the report", () => {
    const ledger = approveAndPost(stateFor()).ledger;
    const report = ready(ledger);
    expect(report.balanceSheet).toMatchObject({ totalAssets: -600.125, currentEarnings: -600.125, totalEquity: -600.125, difference: 0, balanced: true });
    expect(report.balanceSheet.assets.find(({ account }) => account.id === "bank")?.balance).toBe(-600.125);
  });

  it("retains classified zero-balance accounts safely in an empty session without currency", () => {
    const report = ready(createAccountingLedgerState());
    expect(report).toMatchObject({ currency: null, postedEntryCount: 0, includedEntryCount: 0, balanceSheet: { totalAssets: 0, totalLiabilities: 0, totalEquity: 0, difference: 0, balanced: true } });
    expect(report.balanceSheet.assets.map(({ account }) => account.type)).toEqual(["asset", "asset", "asset", "asset"]);
    expect([...report.balanceSheet.assets, ...report.balanceSheet.liabilities, ...report.balanceSheet.equity].every(({ balance }) => balance === 0)).toBe(true);
  });

  it("uses custom chart classifications rather than names and preserves contra balances", () => {
    const accounts: Account[] = [
      { id: "a", code: "1000", name: "Rent Expense", type: "asset" },
      { id: "l", code: "2000", name: "Service Revenue", type: "liability" },
      { id: "e", code: "3000", name: "Cash Asset", type: "equity" },
      { id: "r", code: "4000", name: "Accounts Payable", type: "revenue" },
      { id: "x", code: "5000", name: "Owner Equity", type: "expense" },
    ];
    const journals: JournalEntry[] = [
      { ...entries[1], lines: [{ accountId: "e", debit: 40, credit: 0 }, { accountId: "a", debit: 0, credit: 40 }] },
      { ...entries[2], lines: [{ accountId: "l", debit: 25, credit: 0 }, { accountId: "a", debit: 0, credit: 25 }] },
      { ...entries[0], lines: [{ accountId: "r", debit: 10, credit: 0 }, { accountId: "a", debit: 0, credit: 10 }] },
    ];
    const report = ready({ journalEntries: journals }, undefined, accounts);
    expect(report.balanceSheet.assets.map(({ account }) => account)).toEqual([accounts[0]]);
    expect(report.balanceSheet.liabilities.map(({ account }) => account)).toEqual([accounts[1]]);
    expect(report.balanceSheet.equity.map(({ account }) => account)).toEqual([accounts[2]]);
    expect(report.balanceSheet).toMatchObject({ totalAssets: -75, totalLiabilities: -25, totalAccountEquity: -40, currentEarnings: -10, totalEquity: -50, difference: 0, balanced: true });
  });

  it("reports the actual accumulated difference instead of labelling permitted journal drift balanced", () => {
    const journals = ["first", "second"].map((id): JournalEntry => ({ ...entries[1], id, lines: [
      { accountId: "bank", debit: BALANCE_TOLERANCE, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 0 },
    ] }));
    const report = ready(createAccountingLedgerState(journals));
    expect(report.balanceSheet).toMatchObject({ totalAssets: 2 * BALANCE_TOLERANCE, totalLiabilitiesAndEquity: 0, difference: 2 * BALANCE_TOLERANCE, balanced: false });
    expect(report.balanceSheet.assets.find(({ account }) => account.id === "bank")?.balance).toBe(2 * BALANCE_TOLERANCE);
  });
});

describe("Balance Sheet cumulative inclusive as-of date", () => {
  it("includes earlier assets/equity and the boundary, with earnings from the same journals", () => {
    const ledger = createAccountingLedgerState(entries);
    const included = entries.slice(0, 3);
    const report = ready(ledger, "2026-10-08");
    expect(report).toMatchObject({ currency: "KWD", postedEntryCount: 5, includedEntryCount: 3, asOfDate: "2026-10-08" });
    expect(report.balanceSheet).toEqual(createBalanceSheetStatement(included, DEFAULT_CHART_OF_ACCOUNTS));
    expect(report.balanceSheet.currentEarnings).toBe(classifyProfitAndLoss(included, DEFAULT_CHART_OF_ACCOUNTS).netIncome);
    expect(report.balanceSheet).toMatchObject({ totalAssets: 2399.875, totalLiabilities: 0, totalAccountEquity: 1000, currentEarnings: 1399.875, totalEquity: 2399.875 });
    expect(ready(ledger, "2026-10-07").balanceSheet.currentEarnings).toBe(2000);
    expect(ready(ledger, "2026-10-12").balanceSheet).toEqual(ready(ledger).balanceSheet);
    expect(ready(ledger, "").balanceSheet).toEqual(ready(ledger).balanceSheet);
  });

  it("keeps complete-source currency for a cutoff before the first journal", () => {
    const report = ready(createAccountingLedgerState(entries), "2026-09-30");
    expect(report).toMatchObject({ currency: "KWD", postedEntryCount: 5, includedEntryCount: 0 });
    expect(report.balanceSheet).toEqual(createBalanceSheetStatement([], DEFAULT_CHART_OF_ACCOUNTS));
  });

  it("includes a reversal only on its reviewed journal date, irrespective of posting time", () => {
    const original = approveAndPost(stateFor());
    const pending = reverseChatTransaction(original, "sheet-rent", "sheet-reversal");
    const message = pending.messages.at(-1);
    if (message?.sender !== "ai" || !message.transaction) throw new Error("Expected a reversal.");
    const dated = editChatTransaction(pending, "sheet-reversal", { ...message.transaction.suggestion.entry, date: "2026-10-10" });
    const posted = approveAndPost(dated, "sheet-reversal");
    expect(ready(posted.ledger, "2026-10-09").balanceSheet).toEqual(ready(original.ledger).balanceSheet);
    expect(ready(posted.ledger, "2026-10-10").balanceSheet).toEqual(ready(posted.ledger).balanceSheet);
    expect(ready(posted.ledger, "2026-10-10")).toMatchObject({ includedEntryCount: 2, balanceSheet: { currentEarnings: 0, totalAssets: 0 } });
  });

  it("preserves Core posting-order precision instead of sorting journal dates", () => {
    const journals = [1_000_000_000, 0.001, 0.001].map((amount, index): JournalEntry => ({
      ...entries[2], id: `precision-${index}`, date: ["2026-10-03", "2026-10-01", "2026-10-02"][index],
      lines: [{ accountId: "bank", debit: amount, credit: 0 }, { accountId: "revenue", debit: 0, credit: amount }],
    }));
    const ledger = createAccountingLedgerState(journals);
    expect(ready(ledger, "2026-10-03").balanceSheet).toEqual(createBalanceSheetStatement(journals, DEFAULT_CHART_OF_ACCOUNTS));
    expect(ready(ledger, "2026-10-02").balanceSheet).toEqual(createBalanceSheetStatement(journals.slice(1), DEFAULT_CHART_OF_ACCOUNTS));
  });

  it("allows subsequently posted backdated entries to change earlier historical reports", () => {
    const capital = createAccountingLedgerState([entries[1]]);
    const historicalBefore = ready(capital, "2026-10-03");
    const withBackdatedSales = createAccountingLedgerState([entries[1], entries[2]]);
    const historicalAfter = ready(withBackdatedSales, "2026-10-03");
    expect(historicalBefore.balanceSheet).toMatchObject({ totalAssets: 1000, currentEarnings: 0 });
    expect(historicalAfter.balanceSheet).toMatchObject({ totalAssets: 3000, currentEarnings: 2000 });
  });

  it.each(["2026-02-30", "0000-01-01", "10/01/2026"])("rejects invalid as-of date %s", (date) => {
    const report = getBalanceSheetReport(createAccountingLedgerState(entries), date);
    expect(report).toMatchObject({ status: "error", message: expect.stringContaining("valid as-of date") });
    expect(report).not.toHaveProperty("balanceSheet");
  });

  it.each(["", "2026-02-30", undefined])("allows all-posted amounts but refuses a cutoff for uncertain journal date %j", (date) => {
    const ledger = createAccountingLedgerState([{ ...entries[0], date } as JournalEntry]);
    expect(ready(ledger)).toMatchObject({ undatedEntryCount: 1, includedEntryCount: 1, balanceSheet: { totalAssets: -600.125, currentEarnings: -600.125 } });
    expect(getBalanceSheetReport(ledger, "2026-10-08")).toMatchObject({ status: "error", message: expect.stringContaining("Clear the as-of date") });
  });
});

describe("Balance Sheet validation and read-only behavior", () => {
  it("rejects missing/invalid currency and complete-source mixed currency before a cutoff", () => {
    const source = { journalEntries: [entries[1], { ...entries[2], currency: "USD" }] };
    expect(getBalanceSheetReport(source, "2026-10-01")).toMatchObject({ status: "error", message: expect.stringContaining("one currency") });
    for (const currency of ["", "kd", "invalid"]) {
      expect(getBalanceSheetReport({ journalEntries: [{ ...entries[0], currency }] }, "2026-09-30").status).toBe("error");
    }
    expect(ready({ journalEntries: [{ ...entries[0], currency: "USD" }] }).currency).toBe("USD");
  });

  it("rejects malformed source, missing/duplicate IDs and invalid journals without partial amounts", () => {
    const sources = [null, undefined, {}, { journalEntries: null }, { journalEntries: [null] },
      { journalEntries: [{ ...entries[0], currency: undefined }] },
      { journalEntries: [{ ...entries[0], lines: new Array(2) }] },
      { journalEntries: [{ ...entries[0], id: "" }] },
      { journalEntries: [entries[0], entries[0]] },
      { journalEntries: [{ ...entries[0], lines: [{ accountId: "missing", debit: 600.125, credit: 0 }, { accountId: "bank", debit: 0, credit: 600.125 }] }] },
      { journalEntries: [{ ...entries[0], lines: [{ accountId: "rent-expense", debit: NaN, credit: 0 }, { accountId: "bank", debit: 0, credit: 600.125 }] }] },
      { journalEntries: [{ ...entries[0], lines: [{ accountId: "rent-expense", debit: 600.125, credit: 0 }, { accountId: "bank", debit: 0, credit: 601 }] }] },
    ];
    for (const source of sources) {
      const report = getBalanceSheetReport(source as Parameters<typeof getBalanceSheetReport>[0], "2026-09-30");
      expect(report.status).toBe("error");
      expect(report).not.toHaveProperty("balanceSheet");
    }
  });

  it("rejects overflowing account totals even outside the selected cutoff", () => {
    const journal = { ...entries[1], lines: [{ accountId: "bank", debit: 1e308, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1e308 }] };
    const source = { journalEntries: [journal, { ...journal, id: "overflow" }] };
    expect(getBalanceSheetReport(source, "2026-09-30")).toMatchObject({ status: "error", message: expect.stringContaining("numeric range") });
  });

  it("rejects nonfinite gross totals even when individual balances and statement equation are finite", () => {
    const journals: JournalEntry[] = [
      { ...entries[2], lines: [{ accountId: "bank", debit: 1e308, credit: 0 }, { accountId: "revenue", debit: 0, credit: 1e308 }] },
      { ...entries[0], lines: [{ accountId: "utilities-expense", debit: 1e308, credit: 0 }, { accountId: "bank", debit: 0, credit: 1e308 }] },
    ];
    expect(createBalanceSheetStatement(journals, DEFAULT_CHART_OF_ACCOUNTS)).toMatchObject({ totalAssets: 0, currentEarnings: 0, difference: 0, balanced: true });
    expect(getBalanceSheetReport({ journalEntries: journals })).toMatchObject({ status: "error", message: expect.stringContaining("numeric range") });
  });

  it("does not mutate session snapshots, transactions, workflow, audit history, network or storage", () => {
    const state = approveAndPost(stateFor());
    const snapshot = structuredClone(state);
    freezeRecursively(state);
    const fetch = vi.fn();
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    for (const date of [undefined, "", "2026-10-08", "2026-10-07", "invalid"]) getBalanceSheetReport(state.ledger, date);
    expect(state).toEqual(snapshot);
    expect(state.ledger.journalEntries).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
