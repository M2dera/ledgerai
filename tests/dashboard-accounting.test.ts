import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateAccountBalances } from "@/lib/accounting/ledger";
import { createAccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import type { Account, JournalEntry } from "@/lib/accounting/types";
import { approveChatTransaction, createChatState, postChatTransaction, reverseChatTransaction, type ChatState } from "@/lib/chat";
import { getBalanceSheetReport } from "@/lib/balance-sheet";
import { getDashboardAccountingReport } from "@/lib/dashboard-accounting";
import { getGeneralLedgerView } from "@/lib/general-ledger";
import { getProfitLossReport } from "@/lib/profit-loss";

afterEach(() => vi.unstubAllGlobals());

function ready(
  ledger: Parameters<typeof getDashboardAccountingReport>[0],
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
) {
  const report = getDashboardAccountingReport(ledger, accounts);
  if (report.status !== "ready") throw new Error(report.status === "error" ? report.message : "Expected posted data.");
  return report;
}

function stateFor(status: JournalTransactionStatus = "awaiting_approval", kind: "rent" | "sales" = "rent"): ChatState {
  const parsed = parseTransactionIntent(kind === "rent"
    ? "paid rent 600.125 KWD from bank"
    : "received 2,000 KWD from the customer for services into bank");
  if (parsed.status !== "resolved") throw new Error("Expected a resolved transaction.");
  const suggestion = suggestJournalEntry(parsed.intent, { id: `dashboard-${kind}`, date: "2026-10-08" });
  if (suggestion.status !== "suggested") throw new Error("Expected a suggestion.");
  return createChatState([{ sender: "ai", text: "Transaction suggestion", transaction: { ...createSuggestedTransaction(suggestion.suggestion), status } }]);
}

function approveAndPost(state: ChatState, id = "dashboard-rent") {
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
  { id: "capital", date: "2026-09-25", description: "Earlier owner contribution", currency: "KWD", lines: [
    { accountId: "bank", debit: 1000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1000 },
  ] },
  { id: "sales", date: "2026-10-03", description: "Sales receipt", currency: "KWD", lines: [
    { accountId: "bank", debit: 2000, credit: 0 }, { accountId: "revenue", debit: 0, credit: 2000 },
  ] },
  { id: "utilities", date: "2026-10-15", description: "Unpaid utilities", currency: "KWD", lines: [
    { accountId: "utilities-expense", debit: 120, credit: 0 }, { accountId: "accounts-payable", debit: 0, credit: 120 },
  ] },
  { id: "equipment", date: "2026-10-10", description: "Computer equipment", currency: "KWD", lines: [
    { accountId: "computer-equipment", debit: 500, credit: 0 }, { accountId: "bank", debit: 0, credit: 500 },
  ] },
];

describe("Dashboard posted accounting KPIs", () => {
  it("maps posted revenue, expenses and net income from P&L and balances from the same complete source", () => {
    const ledger = createAccountingLedgerState(entries);
    const report = ready(ledger);
    const profitLoss = getProfitLossReport(ledger);
    const balanceSheet = getBalanceSheetReport(ledger);
    if (profitLoss.status !== "ready" || balanceSheet.status !== "ready") throw new Error("Expected reports.");
    expect(report).toMatchObject({ currency: "KWD", postedEntryCount: 5, undatedEntryCount: 0, revenue: 2000, expenses: 720.125, netIncome: 1279.875 });
    expect(report.revenue).toBe(profitLoss.profitAndLoss.totalRevenue);
    expect(report.expenses).toBe(profitLoss.profitAndLoss.totalExpenses);
    expect(report.netIncome).toBe(profitLoss.profitAndLoss.netIncome);
    for (const accountId of ["cash", "bank"] as const) {
      const balance = report[accountId === "cash" ? "cashBalance" : "bankBalance"];
      const generalLedger = getGeneralLedgerView(ledger, { accountId });
      if (generalLedger.status !== "ready") throw new Error(generalLedger.message);
      expect(balance).toEqual(generalLedger.selectedAccountBalance);
      expect(balance).toEqual(balanceSheet.balanceSheet.assets.find(({ account }) => account.id === accountId));
    }
    expect(report.cashBalance?.balance).toBe(0);
    expect(report.bankBalance?.balance).toBe(1899.875);
    // Earlier capital is part of the cumulative bank balance, alongside all posted movements.
    expect(report.bankBalance?.debitTotal).toBe(3000);
  });

  it("reflects real session posting updates with loss and signed bank balances", () => {
    const unposted = stateFor();
    expect(getDashboardAccountingReport(unposted.ledger).status).toBe("empty");
    const posted = approveAndPost(unposted);
    expect(ready(posted.ledger)).toMatchObject({ postedEntryCount: 1, revenue: 0, expenses: 600.125, netIncome: -600.125, bankBalance: { balance: -600.125 } });
    // Reading a later session snapshot does not cache the earlier empty Dashboard result.
    expect(getDashboardAccountingReport(unposted.ledger).status).toBe("empty");
  });

  it.each(["draft", "awaiting_approval", "approved"] as const)("excludes %s suggestions while retaining the posted session KPIs", (status) => {
    const unposted = stateFor(status);
    expect(getDashboardAccountingReport(unposted.ledger)).toEqual({ status: "empty", currency: null, postedEntryCount: 0 });
    const posted = approveAndPost(stateFor("awaiting_approval", "sales"), "dashboard-sales");
    const withUnposted = { ...posted, messages: [...posted.messages, ...unposted.messages] };
    expect(ready(withUnposted.ledger)).toEqual(ready(posted.ledger));
    expect(ready(withUnposted.ledger)).toMatchObject({ postedEntryCount: 1, revenue: 2000, expenses: 0, netIncome: 2000, bankBalance: { balance: 2000 } });
  });

  it.each(["rent", "sales"] as const)("keeps pending/approved %s reversals out and offsets both sides after posting", (kind) => {
    const id = `dashboard-${kind}`;
    const original = approveAndPost(stateFor("awaiting_approval", kind), id);
    const pending = reverseChatTransaction(original, id, "dashboard-reversal");
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, "dashboard-reversal") };
    for (const state of [pending, approved]) expect(ready(state.ledger)).toEqual(ready(original.ledger));
    const posted = postChatTransaction(approved, "dashboard-reversal");
    expect(ready(posted.ledger)).toMatchObject({ status: "ready", postedEntryCount: 2, revenue: 0, expenses: 0, netIncome: 0, bankBalance: { balance: 0 } });
    expect(posted.ledger.journalEntries[0]).toBe(original.ledger.journalEntries[0]);
    expect(posted.ledger.journalEntries.map(({ id: transactionId }) => transactionId)).toEqual([id, "dashboard-reversal"]);
  });

  it("reports actual posted capital balances even without revenue or expense activity", () => {
    expect(ready(createAccountingLedgerState([entries[1]]))).toMatchObject({ revenue: 0, expenses: 0, netIncome: 0, bankBalance: { balance: 1000 }, postedEntryCount: 1 });
  });

  it("does not fabricate business KPI values for an empty posted ledger", () => {
    const report = getDashboardAccountingReport(createAccountingLedgerState());
    expect(report).toEqual({ status: "empty", currency: null, postedEntryCount: 0 });
    for (const field of ["revenue", "expenses", "netIncome", "cashBalance", "bankBalance"]) expect(report).not.toHaveProperty(field);
  });

  it("preserves contra revenue, negative expenses and signed asset balances", () => {
    const journals: JournalEntry[] = [
      { ...entries[2], lines: [{ accountId: "revenue", debit: 200, credit: 0 }, { accountId: "cash", debit: 0, credit: 200 }] },
      { ...entries[0], lines: [{ accountId: "bank", debit: 75.125, credit: 0 }, { accountId: "rent-expense", debit: 0, credit: 75.125 }] },
    ];
    expect(ready(createAccountingLedgerState(journals))).toMatchObject({ revenue: -200, expenses: -75.125, netIncome: -124.875, cashBalance: { balance: -200 }, bankBalance: { balance: 75.125 } });
  });

  it("recalculates from journals without trusting stale report or account snapshots", () => {
    const ledger = createAccountingLedgerState(entries);
    const stale = { ...ledger,
      balances: ledger.balances.map((balance) => ({ ...balance, balance: 999 })),
      profitAndLoss: { ...ledger.profitAndLoss, totalRevenue: 999, totalExpenses: 999, netIncome: 999 },
      balanceSheet: { ...ledger.balanceSheet, totalAssets: 999, assets: [] },
    };
    expect(ready(stale)).toEqual(ready(ledger));
  });
});

describe("Dashboard default period and canonical assets", () => {
  it("uses all posted session journals without an implicit month, year or today cutoff", () => {
    const journals = [
      { ...entries[1], date: "2025-01-01" },
      { ...entries[2], date: "2025-03-03" },
      { ...entries[0], date: "2027-10-08" },
    ];
    const report = ready(createAccountingLedgerState(journals));
    expect(report).toMatchObject({ postedEntryCount: 3, revenue: 2000, expenses: 600.125, netIncome: 1399.875, bankBalance: { balance: 2399.875 } });
  });

  it("includes amount-valid journals with uncertain dates and exposes their count", () => {
    const journals = [{ ...entries[0], date: "" }, { ...entries[2], date: "2026-02-30" }, { ...entries[1], date: undefined }] as JournalEntry[];
    const report = ready(createAccountingLedgerState(journals));
    expect(report).toMatchObject({ postedEntryCount: 3, undatedEntryCount: 3, revenue: 2000, expenses: 600.125, netIncome: 1399.875, bankBalance: { balance: 2399.875 } });
  });

  it("preserves Core posting-order precision even when journal dates are out of order", () => {
    const journals = [1_000_000_000, 0.001, 0.001].map((amount, index): JournalEntry => ({
      ...entries[2], id: `precision-${index}`, date: ["2026-10-03", "2026-10-01", "2026-10-02"][index],
      lines: [{ accountId: "bank", debit: amount, credit: 0 }, { accountId: "revenue", debit: 0, credit: amount }],
    }));
    const ledger = createAccountingLedgerState(journals);
    const report = ready(ledger);
    expect(report.revenue).toBe(ledger.profitAndLoss.totalRevenue);
    expect(report.netIncome).toBe(ledger.profitAndLoss.netIncome);
    expect(report.bankBalance).toEqual(ledger.balances.find(({ account }) => account.id === "bank"));
  });

  it("uses stable IDs and account types despite misleading display names", () => {
    const accounts: Account[] = DEFAULT_CHART_OF_ACCOUNTS.map((account) => ({ ...account, name:
      account.id === "cash" ? "Service Revenue" : account.id === "bank" ? "Rent Expense" :
      account.id === "revenue" ? "Bank" : account.id === "rent-expense" ? "Cash" : account.name,
    }));
    const report = ready({ journalEntries: entries }, accounts);
    expect(report).toMatchObject({ revenue: 2000, expenses: 720.125, cashBalance: { account: { id: "cash", type: "asset", name: "Service Revenue" }, balance: 0 }, bankBalance: { account: { id: "bank", type: "asset", name: "Rent Expense" }, balance: 1899.875 } });
  });

  it.each(["cash", "bank"] as const)("keeps %s unavailable when its canonical account is missing, nonasset or ambiguous", (id) => {
    const journal: JournalEntry = { ...entries[2], lines: [{ accountId: "accounts-receivable", debit: 2000, credit: 0 }, { accountId: "revenue", debit: 0, credit: 2000 }] };
    const chart = DEFAULT_CHART_OF_ACCOUNTS as readonly Account[];
    const variants = [
      chart.filter((account) => account.id !== id),
      chart.map((account): Account => account.id === id ? { ...account, type: "liability" } : account),
      [...chart, { id, code: "9999", name: "Duplicate asset", type: "asset" } as Account],
      [...chart, { id, code: "9998", name: "Ambiguous classification", type: "equity" } as Account],
    ];
    for (const accounts of variants) {
      const report = ready({ journalEntries: [journal] }, accounts);
      expect(report[id === "cash" ? "cashBalance" : "bankBalance"]).toBeNull();
      expect(report[id === "cash" ? "bankBalance" : "cashBalance"]?.balance).toBe(0);
      expect(report).toMatchObject({ revenue: 2000, expenses: 0, netIncome: 2000 });
    }
  });

  it("does not infer canonical Cash/Bank accounts from other assets with those display names", () => {
    const accounts: Account[] = [
      { id: "other-cash", code: "1005", name: "Cash", type: "asset" },
      { id: "other-bank", code: "1015", name: "Bank", type: "asset" },
      { id: "income", code: "4005", name: "Income", type: "revenue" },
    ];
    const journal: JournalEntry = { ...entries[2], lines: [{ accountId: "other-bank", debit: 2000, credit: 0 }, { accountId: "income", debit: 0, credit: 2000 }] };
    expect(ready({ journalEntries: [journal] }, accounts)).toMatchObject({ revenue: 2000, cashBalance: null, bankBalance: null });
  });
});

describe("Dashboard currency validation and read-only behavior", () => {
  it("rejects missing/invalid or mixed posted currencies without partial KPIs", () => {
    const mixed = getDashboardAccountingReport({ journalEntries: [entries[1], { ...entries[2], currency: "USD" }] });
    expect(mixed).toMatchObject({ status: "error", message: expect.stringContaining("one currency") });
    expect(mixed).not.toHaveProperty("revenue");
    for (const currency of ["", "kd", "invalid"]) {
      expect(getDashboardAccountingReport({ journalEntries: [{ ...entries[0], currency }] }).status).toBe("error");
    }
    expect(ready({ journalEntries: [{ ...entries[0], currency: "USD" }] }).currency).toBe("USD");
  });

  it("validates all source journals and IDs instead of ignoring malformed unrelated data", () => {
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
      const report = getDashboardAccountingReport(source as Parameters<typeof getDashboardAccountingReport>[0]);
      expect(report.status).toBe("error");
      expect(report).not.toHaveProperty("revenue");
      expect(report).not.toHaveProperty("bankBalance");
    }
  });

  it("rejects overflowing source account balances even without revenue/expense activity", () => {
    const journal = { ...entries[1], lines: [{ accountId: "computer-equipment", debit: 1e308, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1e308 }] };
    expect(getDashboardAccountingReport({ journalEntries: [journal, { ...journal, id: "overflow" }] })).toMatchObject({ status: "error", message: expect.stringContaining("numeric range") });
  });

  it("rejects gross-total overflow despite finite account and performance balances", () => {
    const journals: JournalEntry[] = [
      { ...entries[2], lines: [{ accountId: "bank", debit: 1e308, credit: 0 }, { accountId: "revenue", debit: 0, credit: 1e308 }] },
      { ...entries[0], lines: [{ accountId: "utilities-expense", debit: 1e308, credit: 0 }, { accountId: "bank", debit: 0, credit: 1e308 }] },
    ];
    expect(calculateAccountBalances(journals, DEFAULT_CHART_OF_ACCOUNTS).every(({ balance }) => Number.isFinite(balance))).toBe(true);
    expect(getDashboardAccountingReport({ journalEntries: journals })).toMatchObject({ status: "error", message: expect.stringContaining("numeric range") });
  });

  it("does not mutate session snapshots, transactions, workflow, audit history, network or storage", () => {
    const original = approveAndPost(stateFor());
    const state = reverseChatTransaction(original, "dashboard-rent", "dashboard-reversal");
    const snapshot = structuredClone(state);
    freezeRecursively(state);
    const fetch = vi.fn();
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    expect(ready(state.ledger)).toEqual(ready(original.ledger));
    expect(ready(state.ledger)).toEqual(ready(state.ledger));
    expect(state).toEqual(snapshot);
    expect(state.ledger.journalEntries).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
