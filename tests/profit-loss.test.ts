import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { classifyProfitAndLoss } from "@/lib/accounting/statements";
import { createAccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import type { Account, JournalEntry } from "@/lib/accounting/types";
import { approveChatTransaction, createChatState, editChatTransaction, postChatTransaction, reverseChatTransaction, type ChatState } from "@/lib/chat";
import { getProfitLossReport, type ProfitLossFilters } from "@/lib/profit-loss";

afterEach(() => vi.unstubAllGlobals());

function ready(
  ledger: Parameters<typeof getProfitLossReport>[0],
  filters: ProfitLossFilters = {},
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
) {
  const report = getProfitLossReport(ledger, filters, accounts);
  if (report.status !== "ready") throw new Error(report.message);
  return report;
}

function stateFor(status: JournalTransactionStatus = "awaiting_approval", kind: "rent" | "sales" = "rent"): ChatState {
  const parsed = parseTransactionIntent(kind === "rent"
    ? "paid rent 600.125 KWD from bank"
    : "received 2,000 KWD from the customer for services into bank");
  if (parsed.status !== "resolved") throw new Error("Expected a resolved transaction.");
  const suggestion = suggestJournalEntry(parsed.intent, { id: `profit-${kind}`, date: "2026-10-08" });
  if (suggestion.status !== "suggested") throw new Error("Expected a suggestion.");
  return createChatState([{ sender: "ai", text: "Transaction suggestion", transaction: { ...createSuggestedTransaction(suggestion.suggestion), status } }]);
}

function approveAndPost(state: ChatState, id = "profit-rent") {
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
  { id: "sales", date: "2026-10-12", description: "Sales receipt", currency: "KWD", lines: [
    { accountId: "bank", debit: 2000, credit: 0 }, { accountId: "revenue", debit: 0, credit: 2000 },
  ] },
  { id: "utilities", date: "2026-10-15", description: "Unpaid utilities", currency: "KWD", lines: [
    { accountId: "utilities-expense", debit: 120, credit: 0 }, { accountId: "accounts-payable", debit: 0, credit: 120 },
  ] },
];

describe("Profit & Loss posted source and accounting classifications", () => {
  it("returns the existing Core report with posted revenue, expenses and net profit", () => {
    const ledger = createAccountingLedgerState(entries);
    const report = ready(ledger);
    expect(report.profitAndLoss).toEqual(ledger.profitAndLoss);
    expect(report).toMatchObject({ currency: "KWD", postedEntryCount: 4, includedEntryCount: 4, startDate: null, endDate: null, hasActivity: true, undatedEntryCount: 0 });
    expect(report.profitAndLoss).toMatchObject({ totalRevenue: 2000, totalExpenses: 720.125, netIncome: 1279.875 });
    expect(report.profitAndLoss.revenue).toContainEqual(expect.objectContaining({ account: { id: "revenue", code: "4000", name: "Revenue", type: "revenue" }, balance: 2000 }));
    expect(report.profitAndLoss.expenses).toContainEqual(expect.objectContaining({ account: { id: "rent-expense", code: "5000", name: "Rent Expense", type: "expense" }, balance: 600.125 }));
  });

  it("reports a net loss when posted expenses exceed posted revenue", () => {
    const sales = { ...entries[2], lines: [{ accountId: "bank", debit: 250, credit: 0 }, { accountId: "revenue", debit: 0, credit: 250 }] };
    const report = ready(createAccountingLedgerState([entries[0], sales, entries[3]]));
    expect(report.profitAndLoss).toMatchObject({ totalRevenue: 250, totalExpenses: 720.125, netIncome: -470.125 });
  });

  it.each(["draft", "awaiting_approval", "approved"] as const)("excludes %s transactions through the real session posted source", (status) => {
    const unposted = stateFor(status);
    expect(ready(unposted.ledger)).toMatchObject({ includedEntryCount: 0, hasActivity: false, profitAndLoss: { totalRevenue: 0, totalExpenses: 0, netIncome: 0 } });
    const posted = approveAndPost(stateFor("awaiting_approval", "sales"), "profit-sales");
    const withUnposted = { ...posted, messages: [...posted.messages, ...unposted.messages] };
    expect(ready(withUnposted.ledger).profitAndLoss).toEqual(posted.ledger.profitAndLoss);
    expect(ready(withUnposted.ledger)).toMatchObject({ includedEntryCount: 1, profitAndLoss: { totalRevenue: 2000, totalExpenses: 0, netIncome: 2000 } });
  });

  it.each(["rent", "sales"] as const)("keeps an unposted %s reversal out, then offsets both sides once posted", (kind) => {
    const id = `profit-${kind}`;
    const original = approveAndPost(stateFor("awaiting_approval", kind), id);
    const pending = reverseChatTransaction(original, id, "profit-reversal");
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, "profit-reversal") };
    for (const state of [pending, approved]) {
      expect(ready(state.ledger).profitAndLoss).toEqual(original.ledger.profitAndLoss);
      expect(ready(state.ledger).includedEntryCount).toBe(1);
    }
    const posted = postChatTransaction(approved, "profit-reversal");
    const report = ready(posted.ledger);
    expect(report.profitAndLoss).toEqual(posted.ledger.profitAndLoss);
    expect(report).toMatchObject({ includedEntryCount: 2, hasActivity: true, profitAndLoss: { totalRevenue: 0, totalExpenses: 0, netIncome: 0 } });
    expect(posted.ledger.journalEntries[0]).toBe(original.ledger.journalEntries[0]);
  });

  it("uses chart types even when account names suggest different classifications", () => {
    const accounts: Account[] = [
      { id: "cash", code: "1000", name: "Revenue Expense", type: "asset" },
      { id: "sales", code: "4001", name: "Rent Expense", type: "revenue" },
      { id: "cost", code: "5001", name: "Sales Revenue", type: "expense" },
      { id: "loan", code: "2000", name: "Service Revenue", type: "liability" },
      { id: "capital", code: "3000", name: "Utilities Expense", type: "equity" },
    ];
    const journals: JournalEntry[] = [
      { ...entries[2], lines: [{ accountId: "cash", debit: 800, credit: 0 }, { accountId: "sales", debit: 0, credit: 800 }] },
      { ...entries[0], lines: [{ accountId: "cost", debit: 200, credit: 0 }, { accountId: "cash", debit: 0, credit: 200 }] },
      { ...entries[1], lines: [{ accountId: "cash", debit: 100, credit: 0 }, { accountId: "loan", debit: 0, credit: 50 }, { accountId: "capital", debit: 0, credit: 50 }] },
    ];
    const report = ready({ journalEntries: journals }, {}, accounts);
    expect(report.profitAndLoss.revenue.map(({ account }) => account)).toEqual([accounts[1]]);
    expect(report.profitAndLoss.expenses.map(({ account }) => account)).toEqual([accounts[2]]);
    expect(report.profitAndLoss).toMatchObject({ totalRevenue: 800, totalExpenses: 200, netIncome: 600 });
  });

  it("preserves contra revenue and negative expense amounts without clamping", () => {
    const journals: JournalEntry[] = [
      { ...entries[2], lines: [{ accountId: "revenue", debit: 200, credit: 0 }, { accountId: "bank", debit: 0, credit: 200 }] },
      { ...entries[0], lines: [{ accountId: "bank", debit: 75.125, credit: 0 }, { accountId: "rent-expense", debit: 0, credit: 75.125 }] },
    ];
    const report = ready(createAccountingLedgerState(journals));
    expect(report.profitAndLoss).toMatchObject({ totalRevenue: -200, totalExpenses: -75.125, netIncome: -124.875 });
    expect(report.hasActivity).toBe(true);
  });

  it("distinguishes empty and asset/liability/equity-only ledgers from offset P&L activity", () => {
    const empty = ready(createAccountingLedgerState());
    expect(empty).toMatchObject({ currency: null, postedEntryCount: 0, includedEntryCount: 0, hasActivity: false, profitAndLoss: { totalRevenue: 0, totalExpenses: 0, netIncome: 0 } });
    const capital = ready(createAccountingLedgerState([entries[1]]));
    expect(capital).toMatchObject({ currency: "KWD", includedEntryCount: 1, hasActivity: false, profitAndLoss: { totalRevenue: 0, totalExpenses: 0, netIncome: 0 } });
  });
});

describe("Profit & Loss inclusive journal-date period", () => {
  it("includes both boundaries and calculates complete selected journals", () => {
    const ledger = createAccountingLedgerState(entries);
    const report = ready(ledger, { startDate: "2026-10-08", endDate: "2026-10-12" });
    expect(report).toMatchObject({ postedEntryCount: 4, includedEntryCount: 2, startDate: "2026-10-08", endDate: "2026-10-12", hasActivity: true });
    expect(report.profitAndLoss).toEqual(classifyProfitAndLoss([entries[0], entries[2]], DEFAULT_CHART_OF_ACCOUNTS));
    expect(ready(ledger, { startDate: "2026-10-08", endDate: "2026-10-08" }).profitAndLoss).toMatchObject({ totalRevenue: 0, totalExpenses: 600.125, netIncome: -600.125 });
  });

  it("supports start-only and end-only periods", () => {
    const ledger = createAccountingLedgerState(entries);
    expect(ready(ledger, { startDate: "2026-10-12" })).toMatchObject({ includedEntryCount: 2, endDate: null, profitAndLoss: { totalRevenue: 2000, totalExpenses: 120, netIncome: 1880 } });
    expect(ready(ledger, { endDate: "2026-10-08" })).toMatchObject({ includedEntryCount: 2, startDate: null, profitAndLoss: { totalRevenue: 0, totalExpenses: 600.125, netIncome: -600.125 } });
  });

  it("keeps source currency and safe zero totals for an empty selected period", () => {
    const report = ready(createAccountingLedgerState(entries), { startDate: "2027-01-01" });
    expect(report).toMatchObject({ currency: "KWD", postedEntryCount: 4, includedEntryCount: 0, hasActivity: false });
    expect(report.profitAndLoss).toEqual(classifyProfitAndLoss([], DEFAULT_CHART_OF_ACCOUNTS));
  });

  it("uses the reviewed journal date of a posted reversal", () => {
    const original = approveAndPost(stateFor());
    const pending = reverseChatTransaction(original, "profit-rent", "profit-reversal");
    const message = pending.messages.at(-1);
    if (message?.sender !== "ai" || !message.transaction) throw new Error("Expected a reversal.");
    const dated = editChatTransaction(pending, "profit-reversal", { ...message.transaction.suggestion.entry, date: "2026-10-10" });
    const posted = approveAndPost(dated, "profit-reversal");
    expect(ready(posted.ledger, { endDate: "2026-10-09" }).profitAndLoss).toEqual(original.ledger.profitAndLoss);
    expect(ready(posted.ledger, { endDate: "2026-10-10" }).profitAndLoss).toEqual(posted.ledger.profitAndLoss);
    expect(ready(posted.ledger, { startDate: "2026-10-10" })).toMatchObject({ includedEntryCount: 1, profitAndLoss: { totalExpenses: -600.125, netIncome: 600.125 } });
  });

  it("preserves Core posting-order precision instead of sorting journals for calculation", () => {
    const journals = [1_000_000_000, 0.001, 0.001].map((amount, index): JournalEntry => ({
      ...entries[2], id: `precision-${index}`, date: ["2026-10-03", "2026-10-01", "2026-10-02"][index],
      lines: [{ accountId: "bank", debit: amount, credit: 0 }, { accountId: "revenue", debit: 0, credit: amount }],
    }));
    const ledger = createAccountingLedgerState(journals);
    expect(ready(ledger, { endDate: "2026-10-03" }).profitAndLoss).toEqual(ledger.profitAndLoss);
    expect(ready(ledger, { endDate: "2026-10-02" }).profitAndLoss).toEqual(classifyProfitAndLoss(journals.slice(1), DEFAULT_CHART_OF_ACCOUNTS));
  });

  it("rejects a reversed date range without partial report amounts", () => {
    const report = getProfitLossReport(createAccountingLedgerState(entries), { startDate: "2026-10-12", endDate: "2026-10-08" });
    expect(report).toMatchObject({ status: "error", message: expect.stringContaining("start date must be on or before") });
    expect(report).not.toHaveProperty("profitAndLoss");
  });

  it.each(["2026-02-30", "0000-01-01", "10/01/2026"])("rejects invalid date filter %s", (date) => {
    expect(getProfitLossReport(createAccountingLedgerState(entries), { startDate: date }).status).toBe("error");
    expect(getProfitLossReport(createAccountingLedgerState(entries), { endDate: date }).status).toBe("error");
  });

  it.each(["", "2026-02-30", undefined])("allows all-posted amounts but refuses a period for uncertain journal date %j", (date) => {
    const ledger = createAccountingLedgerState([{ ...entries[0], date } as JournalEntry]);
    expect(ready(ledger)).toMatchObject({ undatedEntryCount: 1, includedEntryCount: 1, profitAndLoss: ledger.profitAndLoss });
    expect(getProfitLossReport(ledger, { startDate: "2026-10-08" })).toMatchObject({ status: "error", message: expect.stringContaining("Clear the date filters") });
    expect(getProfitLossReport(ledger, { endDate: "2026-10-08" }).status).toBe("error");
  });
});

describe("Profit & Loss validation and read-only behavior", () => {
  it("enforces complete-source single currency even when the other currency is outside the period", () => {
    const source = { journalEntries: [entries[0], { ...entries[2], currency: "USD" }] };
    expect(getProfitLossReport(source, { endDate: "2026-10-08" })).toMatchObject({ status: "error", message: expect.stringContaining("one currency") });
    for (const currency of ["", "kd", "invalid"]) {
      expect(getProfitLossReport({ journalEntries: [{ ...entries[0], currency }] }, { startDate: "2027-01-01" }).status).toBe("error");
    }
    const usd = ready({ journalEntries: [{ ...entries[0], currency: "USD" }] });
    expect(usd.currency).toBe("USD");
    expect(usd.profitAndLoss.totalExpenses).toBe(600.125);
  });

  it("rejects malformed source, missing or duplicate IDs, and invalid journals without partial amounts", () => {
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
      const report = getProfitLossReport(source as Parameters<typeof getProfitLossReport>[0], { startDate: "2027-01-01" });
      expect(report.status).toBe("error");
      expect(report).not.toHaveProperty("profitAndLoss");
    }
  });

  it("rejects account-total overflow even in non-P&L accounts outside the selected period", () => {
    const journal = { ...entries[1], lines: [{ accountId: "bank", debit: 1e308, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1e308 }] };
    const source = { journalEntries: [journal, { ...journal, id: "overflow" }] };
    expect(getProfitLossReport(source, { startDate: "2027-01-01" })).toMatchObject({ status: "error", message: expect.stringContaining("numeric range") });
  });

  it("rejects nonfinite aggregate totals when individual balances are finite", () => {
    const journals: JournalEntry[] = [
      { ...entries[2], lines: [{ accountId: "bank", debit: 1e308, credit: 0 }, { accountId: "revenue", debit: 0, credit: 1e308 }] },
      { ...entries[1], lines: [{ accountId: "cash", debit: 1e308, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1e308 }] },
    ];
    expect(getProfitLossReport({ journalEntries: journals })).toMatchObject({ status: "error", message: expect.stringContaining("numeric range") });
  });

  it("does not mutate the session, derived snapshots, workflow, audit history, network or storage", () => {
    const state = approveAndPost(stateFor());
    const snapshot = structuredClone(state);
    freezeRecursively(state);
    const fetch = vi.fn();
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    for (const filters of [{}, { startDate: "2026-10-08" }, { endDate: "2026-10-07" }, { startDate: "2027-01-01" }, { startDate: "invalid" }]) {
      getProfitLossReport(state.ledger, filters);
    }
    expect(state).toEqual(snapshot);
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
