import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateAccountBalance, calculateLedgerTotals, createTrialBalance } from "@/lib/accounting/ledger";
import { createAccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import type { JournalEntry } from "@/lib/accounting/types";
import { approveChatTransaction, createChatState, postChatTransaction, reverseChatTransaction, type ChatState } from "@/lib/chat";
import { getGeneralLedgerView, type GeneralLedgerFilters } from "@/lib/general-ledger";

afterEach(() => vi.unstubAllGlobals());

function stateFor(status: JournalTransactionStatus = "awaiting_approval") {
  const parsed = parseTransactionIntent("paid rent 600.125 KWD from bank");
  if (parsed.status !== "resolved") throw new Error("Expected a resolved transaction.");
  const suggested = suggestJournalEntry(parsed.intent, { id: "ledger-rent", date: "2026-10-03" });
  if (suggested.status !== "suggested") throw new Error("Expected a suggested entry.");
  return createChatState([{ sender: "ai", text: "Rent suggestion", transaction: { ...createSuggestedTransaction(suggested.suggestion), status } }]);
}

function approveAndPost(state: ChatState, id = "ledger-rent") {
  return postChatTransaction({ ...state, messages: approveChatTransaction(state.messages, id) }, id);
}

function ready(ledger: Parameters<typeof getGeneralLedgerView>[0], filters: GeneralLedgerFilters = {}) {
  const view = getGeneralLedgerView(ledger, filters);
  if (view.status !== "ready") throw new Error(view.message);
  return view;
}

function freezeRecursively(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

const journals: JournalEntry[] = [
  { id: "rent", date: "2026-10-03", description: "Rent payment", currency: "KWD", lines: [
    { accountId: "rent-expense", debit: 600, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 },
  ] },
  { id: "capital", date: "2026-10-01", description: "Owner contribution", currency: "KWD", lines: [
    { accountId: "bank", debit: 1000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1000 },
  ] },
  { id: "sales", date: "2026-10-02", description: "Sales receipt", currency: "KWD", lines: [
    { accountId: "bank", debit: 250, credit: 0 }, { accountId: "revenue", debit: 0, credit: 250 },
  ] },
  { id: "utilities", date: "2026-10-04", description: "Unpaid utilities invoice", currency: "KWD", lines: [
    { accountId: "utilities-expense", debit: 120, credit: 0 }, { accountId: "accounts-payable", debit: 0, credit: 120 },
  ] },
];

describe("General Ledger posted data", () => {
  it.each(["draft", "awaiting_approval", "approved"] as const)("excludes %s entries and displays only the existing posted source", (status) => {
    const state = stateFor(status);
    expect(ready(state.ledger).rows).toEqual([]);
    const posted = approveAndPost(stateFor());
    const withUnpostedMessages = { ...posted, messages: [...posted.messages, ...state.messages] };
    const view = ready(withUnpostedMessages.ledger);
    expect(view.rows).toHaveLength(2);
    expect(view.rows.map(({ transactionId }) => transactionId)).toEqual(["ledger-rent", "ledger-rent"]);
    expect(view.rows[0]).toMatchObject({ date: "2026-10-03", description: expect.any(String), account: { id: "rent-expense" }, debit: 600.125, credit: 0 });
    expect(view.currency).toBe("KWD");
  });

  it("includes a reversal only after explicit posting and keeps the original visible", () => {
    const original = approveAndPost(stateFor());
    const pending = reverseChatTransaction(original, "ledger-rent", "ledger-reversal");
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, "ledger-reversal") };
    for (const state of [original, pending, approved]) {
      expect(ready(state.ledger).rows).toHaveLength(2);
      expect(ready(state.ledger, { accountId: "rent-expense" }).selectedAccountBalance?.balance).toBe(600.125);
    }
    const posted = postChatTransaction(approved, "ledger-reversal");
    const all = ready(posted.ledger);
    expect(all.rows.map(({ transactionId }) => transactionId)).toEqual(["ledger-rent", "ledger-rent", "ledger-reversal", "ledger-reversal"]);
    expect(posted.ledger.journalEntries[0]).toBe(original.ledger.journalEntries[0]);
    const account = ready(posted.ledger, { accountId: "rent-expense" });
    expect(account.rows).toHaveLength(2);
    expect(account.selectedAccountBalance).toMatchObject({ debitTotal: 600.125, creditTotal: 600.125, balance: 0 });
    expect(posted.ledger.trialBalance).toMatchObject({ totalDebits: 0, totalCredits: 0, balanced: true });
  });

  it("returns safe zero totals for an empty ledger and an unused selected account", () => {
    const view = ready(createAccountingLedgerState(), { accountId: "bank" });
    expect(view).toMatchObject({ rows: [], currency: null, postedEntryCount: 0, totals: { debitTotal: 0, creditTotal: 0 }, selectedAccountBalance: { debitTotal: 0, creditTotal: 0, balance: 0 } });
  });
});

describe("General Ledger filters and Accounting Core totals", () => {
  it.each([
    ["bank", 1250, 600, 650],
    ["rent-expense", 600, 0, 600],
    ["accounts-payable", 0, 120, 120],
    ["owners-equity", 0, 1000, 1000],
    ["revenue", 0, 250, 250],
  ] as const)("filters %s and respects its normal balance and Trial Balance", (accountId, debitTotal, creditTotal, balance) => {
    const ledger = createAccountingLedgerState(journals);
    const view = ready(ledger, { accountId });
    const account = DEFAULT_CHART_OF_ACCOUNTS.find(({ id }) => id === accountId)!;
    expect(view.rows.every(({ account }) => account.id === accountId)).toBe(true);
    expect(view.rows).toHaveLength(accountId === "bank" ? 3 : 1);
    expect(view.selectedAccountBalance).toEqual(calculateAccountBalance(account, journals, DEFAULT_CHART_OF_ACCOUNTS));
    expect(view.selectedAccountBalance).toMatchObject({ debitTotal, creditTotal, balance });
    const trialLine = ledger.trialBalance.lines.find(({ account }) => account.id === accountId)!;
    expect(trialLine.debitBalance).toBe(Math.max(debitTotal - creditTotal, 0));
    expect(trialLine.creditBalance).toBe(Math.max(creditTotal - debitTotal, 0));
    expect(view.totals).toEqual(calculateLedgerTotals(journals, DEFAULT_CHART_OF_ACCOUNTS));
  });

  it("keeps gross ledger totals distinct from net Trial Balance totals", () => {
    const ledger = createAccountingLedgerState(journals);
    expect(ready(ledger).totals).toEqual({ currency: "KWD", debitTotal: 1970, creditTotal: 1970 });
    expect(ledger.trialBalance).toMatchObject({ totalDebits: 1370, totalCredits: 1370, balanced: true });
  });

  it("preserves core summation order while displaying entries by date", () => {
    const entries = [1_000_000_000, 0.001, 0.001].map((amount, index): JournalEntry => ({
      id: `precision-${index}`, date: ["2026-10-03", "2026-10-01", "2026-10-02"][index],
      description: "Owner contribution", currency: "KWD", lines: [
        { accountId: "bank", debit: amount, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: amount },
      ],
    }));
    const ledger = createAccountingLedgerState(entries);
    const view = ready(ledger, { accountId: "bank" });
    expect(view.rows.map(({ transactionId }) => transactionId)).toEqual(["precision-1", "precision-2", "precision-0"]);
    expect(view.selectedAccountBalance).toEqual(ledger.balances.find(({ account }) => account.id === "bank"));
    expect(view.totals).toEqual(calculateLedgerTotals(entries, DEFAULT_CHART_OF_ACCOUNTS));
  });

  it("applies inclusive date filters to full journals and calculates account period movement through core", () => {
    const ledger = createAccountingLedgerState(journals);
    const view = ready(ledger, { accountId: "bank", startDate: "2026-10-02", endDate: "2026-10-03" });
    const periodJournals = [journals[2], journals[0]];
    expect(view.rows.map(({ transactionId }) => transactionId)).toEqual(["sales", "rent"]);
    expect(view.hasDateFilter).toBe(true);
    expect(view.totals).toEqual(calculateLedgerTotals(periodJournals, DEFAULT_CHART_OF_ACCOUNTS));
    const bank = DEFAULT_CHART_OF_ACCOUNTS.find(({ id }) => id === "bank")!;
    expect(view.selectedAccountBalance).toEqual(calculateAccountBalance(bank, periodJournals, DEFAULT_CHART_OF_ACCOUNTS));
    expect(view.selectedAccountBalance?.balance).toBe(-350);
    expect(createTrialBalance(periodJournals, DEFAULT_CHART_OF_ACCOUNTS).balanced).toBe(true);
    expect(ready(ledger, { startDate: "2026-10-04" }).rows.map(({ transactionId }) => transactionId)).toEqual(["utilities", "utilities"]);
    expect(ready(ledger, { endDate: "2026-10-01" }).rows.map(({ transactionId }) => transactionId)).toEqual(["capital", "capital"]);
  });

  it("retains the session currency when a period has no matches", () => {
    const view = ready(createAccountingLedgerState(journals), { accountId: "bank", startDate: "2027-01-01" });
    expect(view).toMatchObject({ rows: [], currency: "KWD", postedEntryCount: 4, selectedAccountBalance: { debitTotal: 0, creditTotal: 0, balance: 0 } });
  });

  it("does not mutate journals, session state or derived snapshots when viewing and filtering", () => {
    const state = approveAndPost(stateFor());
    const before = structuredClone(state);
    freezeRecursively(state);
    const fetch = vi.fn();
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    for (const filters of [{}, { accountId: "bank" }, { accountId: "rent-expense", startDate: "2026-10-01" }, { endDate: "2026-10-02" }]) {
      expect(ready(state.ledger, filters).status).toBe("ready");
    }
    expect(state).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

describe("General Ledger invalid and missing data", () => {
  it.each([
    { accountId: "missing" },
    { startDate: "2026-02-30" },
    { endDate: "0000-01-01" },
    { startDate: "10/01/2026" },
    { startDate: "2026-10-04", endDate: "2026-10-01" },
  ])("rejects an invalid filter safely: %j", (filters) => {
    expect(getGeneralLedgerView(createAccountingLedgerState(journals), filters).status).toBe("error");
  });

  it("handles unavailable or malformed data without partial amounts", () => {
    for (const ledger of [null, undefined, {}, { journalEntries: null }, { journalEntries: [null] }, { journalEntries: [{ ...journals[0], currency: null }] }, { journalEntries: [{ ...journals[0], lines: null }] }, { journalEntries: [{ ...journals[0], lines: new Array(2) }] }]) {
      const view = getGeneralLedgerView(ledger as Parameters<typeof getGeneralLedgerView>[0]);
      expect(view).toMatchObject({ status: "error", message: expect.any(String) });
      expect(view).not.toHaveProperty("totals");
    }
  });

  it.each([
    { lines: [{ accountId: "missing", debit: 600, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 }] },
    { lines: [{ accountId: "rent-expense", debit: NaN, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 }] },
    { lines: [{ accountId: "rent-expense", debit: 601, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 }] },
    { currency: "bad-code" },
    { id: "" },
  ])("refuses invalid posted data even when it would be outside the period: %j", (override) => {
    const ledger = { journalEntries: [{ ...journals[0], ...override }, journals[1]] };
    expect(getGeneralLedgerView(ledger, { startDate: "2027-01-01" }).status).toBe("error");
  });

  it("respects mixed-currency and duplicate transaction restrictions before filtering", () => {
    expect(getGeneralLedgerView({ journalEntries: [journals[0], { ...journals[1], currency: "USD" }] }, { endDate: "2026-10-01" })).toMatchObject({ status: "error", message: expect.stringContaining("one currency") });
    expect(getGeneralLedgerView({ journalEntries: [journals[0], journals[0]] }).status).toBe("error");
  });

  it("rejects overflowing aggregates rather than displaying Infinity", () => {
    const lines = [{ accountId: "bank", debit: 1e308, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1e308 }];
    const entries = [{ ...journals[0], lines }, { ...journals[1], lines }];
    expect(getGeneralLedgerView({ journalEntries: entries })).toMatchObject({ status: "error", message: expect.stringContaining("numeric range") });
  });

  it("keeps missing descriptions and invalid dates visible with safe metadata fallbacks", () => {
    const entries = [{ ...journals[0], date: "2026-02-30", description: undefined }, { ...journals[1], date: "2024-02-29" }] as JournalEntry[];
    const ledger = createAccountingLedgerState(entries);
    const view = ready(ledger);
    expect(view.rows.map(({ transactionId }) => transactionId)).toEqual(["capital", "capital", "rent", "rent"]);
    expect(view.rows[2]).toMatchObject({ date: null, description: "No description" });
    expect(view.undatedEntryCount).toBe(1);
    const filtered = ready(ledger, { startDate: "2024-02-29", endDate: "2024-02-29" });
    expect(filtered.rows).toHaveLength(2);
    expect(filtered.undatedEntryCount).toBe(1);
  });
});
