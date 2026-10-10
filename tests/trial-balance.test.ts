import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateLedgerTotals, createTrialBalance } from "@/lib/accounting/ledger";
import { createAccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import type { JournalEntry } from "@/lib/accounting/types";
import { approveChatTransaction, createChatState, editChatTransaction, postChatTransaction, reverseChatTransaction, type ChatState } from "@/lib/chat";
import { getTrialBalanceReport } from "@/lib/trial-balance";

afterEach(() => vi.unstubAllGlobals());

function ready(ledger: Parameters<typeof getTrialBalanceReport>[0], asOfDate?: string) {
  const report = getTrialBalanceReport(ledger, asOfDate);
  if (report.status !== "ready") throw new Error(report.message);
  return report;
}

function stateFor(status: JournalTransactionStatus = "awaiting_approval"): ChatState {
  const parsed = parseTransactionIntent("paid rent 600.125 KWD from bank");
  if (parsed.status !== "resolved") throw new Error("Expected a resolved transaction.");
  const suggestion = suggestJournalEntry(parsed.intent, { id: "trial-rent", date: "2026-10-08" });
  if (suggestion.status !== "suggested") throw new Error("Expected a suggestion.");
  return createChatState([{ sender: "ai", text: "Rent suggestion", transaction: { ...createSuggestedTransaction(suggestion.suggestion), status } }]);
}

function approveAndPost(state: ChatState, id = "trial-rent") {
  return postChatTransaction({ ...state, messages: approveChatTransaction(state.messages, id) }, id);
}

function line(report: ReturnType<typeof ready>, accountId: string) {
  const result = report.trialBalance.lines.find(({ account }) => account.id === accountId);
  if (!result) throw new Error("Missing account row.");
  return result;
}

function freezeRecursively(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

const entries: JournalEntry[] = [
  { id: "rent", date: "2026-10-08", description: "Rent payment", currency: "KWD", lines: [
    { accountId: "rent-expense", debit: 600, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 },
  ] },
  { id: "capital", date: "2026-10-01", description: "Owner contribution", currency: "KWD", lines: [
    { accountId: "bank", debit: 1000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1000 },
  ] },
  { id: "sales", date: "2026-10-12", description: "Sales receipt", currency: "KWD", lines: [
    { accountId: "bank", debit: 250, credit: 0 }, { accountId: "revenue", debit: 0, credit: 250 },
  ] },
  { id: "invoice", date: "2026-10-15", description: "Unpaid utilities", currency: "KWD", lines: [
    { accountId: "utilities-expense", debit: 120, credit: 0 }, { accountId: "accounts-payable", debit: 0, credit: 120 },
  ] },
];

describe("Trial Balance posted source", () => {
  it("returns existing Core account balances, totals, currency, difference and status", () => {
    const ledger = createAccountingLedgerState(entries);
    const report = ready(ledger);
    expect(report.trialBalance).toEqual(ledger.trialBalance);
    expect(report).toMatchObject({ postedEntryCount: 4, includedEntryCount: 4, asOfDate: null, currency: "KWD" });
    expect(report.trialBalance).toMatchObject({ totalDebits: 1370, totalCredits: 1370, difference: 0, balanced: true });
    expect(line(report, "bank")).toMatchObject({ debitBalance: 650, creditBalance: 0 });
    expect(line(report, "rent-expense")).toMatchObject({ debitBalance: 600, creditBalance: 0 });
    expect(line(report, "accounts-payable")).toMatchObject({ debitBalance: 0, creditBalance: 120 });
    expect(line(report, "owners-equity")).toMatchObject({ debitBalance: 0, creditBalance: 1000 });
    expect(line(report, "revenue")).toMatchObject({ debitBalance: 0, creditBalance: 250 });
    // Gross journal totals are different from the displayed net account-balance totals.
    expect(calculateLedgerTotals(entries, DEFAULT_CHART_OF_ACCOUNTS).debitTotal).toBe(1970);
  });

  it.each(["draft", "awaiting_approval", "approved"] as const)("excludes %s entries", (status) => {
    const unposted = stateFor(status);
    expect(ready(unposted.ledger).includedEntryCount).toBe(0);
    expect(ready(unposted.ledger).trialBalance).toMatchObject({ totalDebits: 0, totalCredits: 0, difference: 0 });
    const posted = approveAndPost(stateFor());
    const withUnposted = { ...posted, messages: [...posted.messages, ...unposted.messages] };
    expect(ready(withUnposted.ledger).trialBalance).toEqual(posted.ledger.trialBalance);
    expect(line(ready(withUnposted.ledger), "bank")).toMatchObject({ debitBalance: 0, creditBalance: 600.125 });
  });

  it("keeps unposted reversals out, then includes both posted original and reversal", () => {
    const original = approveAndPost(stateFor());
    const pending = reverseChatTransaction(original, "trial-rent", "trial-reversal");
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, "trial-reversal") };
    for (const state of [pending, approved]) {
      expect(ready(state.ledger).trialBalance).toEqual(original.ledger.trialBalance);
      expect(ready(state.ledger).includedEntryCount).toBe(1);
    }
    const posted = postChatTransaction(approved, "trial-reversal");
    const report = ready(posted.ledger);
    expect(report.trialBalance).toEqual(posted.ledger.trialBalance);
    expect(report.includedEntryCount).toBe(2);
    expect(report.trialBalance.lines.every(({ debitBalance, creditBalance }) => debitBalance === 0 && creditBalance === 0)).toBe(true);
    expect(report.trialBalance).toMatchObject({ totalDebits: 0, totalCredits: 0, difference: 0, balanced: true });
    expect(posted.ledger.journalEntries[0]).toBe(original.ledger.journalEntries[0]);
    // The default reversing entry uses the original journal date, so both contribute to that cutoff after posting.
    expect(ready(posted.ledger, "2026-10-08").trialBalance).toEqual(posted.ledger.trialBalance);
  });

  it("includes all zero-balance accounts and keeps an empty ledger safe without inventing currency", () => {
    const report = ready(createAccountingLedgerState());
    expect(report.currency).toBeNull();
    expect(report.trialBalance.lines.map(({ account }) => account)).toEqual([...DEFAULT_CHART_OF_ACCOUNTS]);
    expect(report.trialBalance.lines.every(({ debitBalance, creditBalance }) => debitBalance === 0 && creditBalance === 0)).toBe(true);
    expect(report.trialBalance).toMatchObject({ totalDebits: 0, totalCredits: 0, difference: 0, balanced: true });
  });

  it("uses Core net-account status even when gross journals balance and a stale snapshot claims Balanced", () => {
    const journal: JournalEntry = { ...entries[0], lines: [
      { accountId: "bank", debit: 2e-9, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: 1e-9 },
      { accountId: "revenue", debit: 0, credit: 1e-9 },
    ] };
    const ledger = createAccountingLedgerState([journal]);
    const stale = { ...ledger, trialBalance: { ...ledger.trialBalance, balanced: true } };
    expect(calculateLedgerTotals([journal], DEFAULT_CHART_OF_ACCOUNTS)).toMatchObject({ debitTotal: 2e-9, creditTotal: 2e-9 });
    expect(ready(stale).trialBalance).toMatchObject({ totalDebits: 2e-9, totalCredits: 0, difference: 2e-9, balanced: false });
  });
});

describe("Trial Balance cumulative as-of date", () => {
  it("includes earlier balances and the inclusive boundary, rather than only period movement", () => {
    const ledger = createAccountingLedgerState(entries);
    const report = ready(ledger, "2026-10-08");
    expect(report).toMatchObject({ asOfDate: "2026-10-08", postedEntryCount: 4, includedEntryCount: 2, currency: "KWD" });
    expect(report.trialBalance).toEqual(createTrialBalance(entries.slice(0, 2), DEFAULT_CHART_OF_ACCOUNTS));
    expect(line(report, "bank")).toMatchObject({ debitBalance: 400, creditBalance: 0 });
    expect(line(report, "owners-equity")).toMatchObject({ debitBalance: 0, creditBalance: 1000 });
    expect(line(report, "revenue")).toMatchObject({ debitBalance: 0, creditBalance: 0 });
    expect(report.trialBalance).toMatchObject({ totalDebits: 1000, totalCredits: 1000 });
    expect(ready(ledger, "2026-10-15").trialBalance).toEqual(ledger.trialBalance);
    expect(ready(ledger, "2026-10-07").includedEntryCount).toBe(1);
  });

  it("returns zero accounts before the first dated entry while preserving Core-validated source currency", () => {
    const report = ready(createAccountingLedgerState(entries), "2026-09-30");
    expect(report).toMatchObject({ currency: "KWD", includedEntryCount: 0, postedEntryCount: 4 });
    expect(report.trialBalance).toEqual(createTrialBalance([], DEFAULT_CHART_OF_ACCOUNTS));
  });

  it("offsets a posted reversal only at its inclusive reviewed journal date", () => {
    const original = approveAndPost(stateFor());
    const pending = reverseChatTransaction(original, "trial-rent", "trial-reversal");
    const message = pending.messages.at(-1);
    if (message?.sender !== "ai" || !message.transaction) throw new Error("Expected a reversal.");
    const dated = editChatTransaction(pending, "trial-reversal", { ...message.transaction.suggestion.entry, date: "2026-10-10" });
    const posted = approveAndPost(dated, "trial-reversal");
    expect(ready(posted.ledger, "2026-10-09").trialBalance).toEqual(original.ledger.trialBalance);
    expect(ready(posted.ledger, "2026-10-10").trialBalance).toEqual(posted.ledger.trialBalance);
    expect(ready(posted.ledger, "2026-10-10").includedEntryCount).toBe(2);
  });

  it("preserves posting-order precision even when journal dates are out of order", () => {
    const journals = [1_000_000_000, 0.001, 0.001].map((amount, index): JournalEntry => ({
      ...entries[1], id: `precision-${index}`, date: ["2026-10-03", "2026-10-01", "2026-10-02"][index],
      lines: [{ accountId: "bank", debit: amount, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: amount }],
    }));
    const ledger = createAccountingLedgerState(journals);
    expect(ready(ledger, "2026-10-03").trialBalance).toEqual(ledger.trialBalance);
    expect(ready(ledger, "2026-10-02").trialBalance).toEqual(createTrialBalance(journals.slice(1), DEFAULT_CHART_OF_ACCOUNTS));
  });

  it.each(["2026-02-30", "0000-01-01", "10/01/2026"])("rejects invalid as-of date %s", (date) => {
    expect(getTrialBalanceReport(createAccountingLedgerState(entries), date)).toMatchObject({ status: "error", message: expect.stringContaining("valid as-of date") });
  });

  it.each(["", "2026-02-30", undefined])("refuses an uncertain historical balance for missing/invalid journal date %j", (date) => {
    const ledger = createAccountingLedgerState([{ ...entries[0], date } as JournalEntry]);
    expect(ready(ledger).trialBalance).toEqual(ledger.trialBalance);
    expect(getTrialBalanceReport(ledger, "2026-10-08")).toMatchObject({ status: "error", message: expect.stringContaining("missing or invalid journal date") });
  });
});

describe("Trial Balance safety", () => {
  it("rejects mixed and invalid currency across the full posted source, even outside the cutoff", () => {
    const ledger = { journalEntries: [entries[1], { ...entries[2], currency: "USD" }] };
    expect(getTrialBalanceReport(ledger, "2026-10-01")).toMatchObject({ status: "error", message: expect.stringContaining("one currency") });
    for (const currency of ["", "kd", "invalid"]) {
      expect(getTrialBalanceReport({ journalEntries: [{ ...entries[0], currency }] }).status).toBe("error");
    }
  });

  it("rejects malformed journals, missing/duplicate IDs, and invalid accounting lines without partial amounts", () => {
    const badSources = [null, undefined, {}, { journalEntries: null }, { journalEntries: [null] },
      { journalEntries: [{ ...entries[0], lines: new Array(2) }] },
      { journalEntries: [{ ...entries[0], id: "" }] },
      { journalEntries: [entries[0], entries[0]] },
      { journalEntries: [{ ...entries[0], lines: [{ accountId: "missing", debit: 600, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 }] }] },
      { journalEntries: [{ ...entries[0], lines: [{ accountId: "bank", debit: NaN, credit: 0 }, { accountId: "revenue", debit: 0, credit: 600 }] }] },
      { journalEntries: [{ ...entries[0], lines: [{ accountId: "bank", debit: 600, credit: 0 }, { accountId: "revenue", debit: 0, credit: 601 }] }] },
    ];
    for (const source of badSources) {
      const report = getTrialBalanceReport(source as Parameters<typeof getTrialBalanceReport>[0]);
      expect(report.status).toBe("error");
      expect(report).not.toHaveProperty("trialBalance");
    }
  });

  it("rejects overflowing account totals even when Core net lines would suppress NaN to zero", () => {
    const journal = { ...entries[0], lines: [{ accountId: "bank", debit: 1e308, credit: 0 }, { accountId: "bank", debit: 0, credit: 1e308 }] };
    const journals = [journal, { ...journal, id: "overflow" }];
    expect(createTrialBalance(journals, DEFAULT_CHART_OF_ACCOUNTS).balanced).toBe(true);
    expect(getTrialBalanceReport({ journalEntries: journals })).toMatchObject({ status: "error", message: expect.stringContaining("numeric range") });
  });

  it("rejects overflowing report totals even when individual account balances are finite", () => {
    const journals: JournalEntry[] = [
      { ...entries[0], lines: [{ accountId: "bank", debit: 1e308, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1e308 }] },
      { ...entries[1], lines: [{ accountId: "cash", debit: 1e308, credit: 0 }, { accountId: "revenue", debit: 0, credit: 1e308 }] },
    ];
    expect(getTrialBalanceReport({ journalEntries: journals })).toMatchObject({ status: "error", message: expect.stringContaining("numeric range") });
  });

  it("does not change ledger, workflow, audit history, storage, or network state when viewing/filtering", () => {
    const state = approveAndPost(stateFor());
    const snapshot = structuredClone(state);
    freezeRecursively(state);
    const fetch = vi.fn();
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    for (const date of [undefined, "2026-10-08", "2026-10-07", "invalid"]) getTrialBalanceReport(state.ledger, date);
    expect(state).toEqual(snapshot);
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
