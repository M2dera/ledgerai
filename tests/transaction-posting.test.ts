import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { MixedCurrencyLedgerError } from "@/lib/accounting/ledger";
import * as coreLedger from "@/lib/accounting/ledger";
import * as coreStatements from "@/lib/accounting/statements";
import { suggestJournalEntry, type SuggestedJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import {
  createAccountingLedgerState,
  postJournalTransaction,
  type AccountingLedgerState,
} from "@/lib/accounting/transaction-posting";
import {
  createSuggestedTransaction,
  transitionJournalTransaction,
  type JournalTransaction,
} from "@/lib/accounting/transaction-workflow";
import type { JournalEntry } from "@/lib/accounting/types";
import { InvalidJournalEntryError } from "@/lib/accounting/validation";
import * as coreValidation from "@/lib/accounting/validation";
import { analyzeData, createUploadedFile } from "@/lib/analysis/analyzer";
import { routeFinancialQuestion } from "@/lib/analysis/chat";
import {
  approveChatTransaction,
  createChatState,
  postChatTransaction,
  routeChatMessage,
  type ChatMessage,
} from "@/lib/chat";
import { readExcel } from "@/lib/excel/reader";
import type { FinancialDataset } from "@/lib/financial/types";
import * as financialStore from "@/lib/store/financialStore";

const rentMessage = "دفعت إيجار 600 د.ك من البنك";
const metadata = { id: "posted-rent-1", date: "2026-10-08" };
let dataset: FinancialDataset;

beforeAll(async () => {
  const bytes = await readFile("test-data/LedgerAI_test_financial_data.xlsx");
  const file = new File([bytes], "LedgerAI_test_financial_data.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  dataset = analyzeData(await readExcel(file), createUploadedFile(file));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function freezeRecursively(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

function suggestion(message = rentMessage, id = metadata.id): SuggestedJournalEntry {
  const parsed = parseTransactionIntent(message);
  if (parsed.status !== "resolved") throw new Error("Expected a resolved transaction intent.");
  const result = suggestJournalEntry(parsed.intent, { ...metadata, id });
  if (result.status !== "suggested") throw new Error("Expected a validated journal suggestion.");
  return result.suggestion;
}

function approvedTransaction(message = rentMessage, id = metadata.id): JournalTransaction {
  return transitionJournalTransaction(createSuggestedTransaction(suggestion(message, id)), "approved");
}

function messageFor(transaction: JournalTransaction): ChatMessage {
  return { sender: "ai", text: "Accounting suggestion", transaction };
}

function balance(ledger: AccountingLedgerState, accountId: string) {
  const result = ledger.balances.find(({ account }) => account.id === accountId);
  if (!result) throw new Error(`Missing ledger account ${accountId}.`);
  return result;
}

function capitalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "opening-capital",
    date: "2026-10-01",
    description: "Owner contribution",
    currency: "KWD",
    lines: [
      { accountId: "bank", debit: 1_000, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: 1_000 },
    ],
    ...overrides,
  };
}

describe("explicit journal transaction posting", () => {
  it("keeps suggestions awaiting approval until explicit approval and posting", () => {
    const review = createSuggestedTransaction(suggestion());
    const emptyLedger = createAccountingLedgerState();

    expect(review.status).toBe("awaiting_approval");
    expect(emptyLedger.journalEntries).toEqual([]);
    expect(emptyLedger.trialBalance).toMatchObject({
      currency: null, totalDebits: 0, totalCredits: 0, balanced: true,
    });
    const approved = transitionJournalTransaction(review, "approved");
    expect(emptyLedger.journalEntries).toEqual([]);
    expect(postJournalTransaction(approved, emptyLedger).transaction.status).toBe("posted");
    expect(review.status).toBe("awaiting_approval");
    expect(approved.status).toBe("approved");
  });

  it.each(["draft", "awaiting_approval", "posted"] as const)("rejects posting from %s without changing the ledger", (status) => {
    const transaction: JournalTransaction = { status, suggestion: suggestion() };
    const ledger = createAccountingLedgerState([capitalEntry()]);
    const before = structuredClone(ledger);
    freezeRecursively(transaction);
    freezeRecursively(ledger);

    expect(() => postJournalTransaction(transaction, ledger)).toThrow(Error);
    expect(transaction.status).toBe(status);
    expect(ledger).toEqual(before);
  });

  it.each(["draft", "awaiting_approval", "approved", "posted"] as const)("rejects a status-only posting transition from %s", (status) => {
    const transaction: JournalTransaction = { status, suggestion: suggestion() };

    expect(() => transitionJournalTransaction(transaction, "posted")).toThrow(Error);
    expect(transaction.status).toBe(status);
  });

  it("posts an approved rent entry through the ledger and preserves all original journal evidence", () => {
    const approved = approvedTransaction();
    const ledger = createAccountingLedgerState();
    const evidenceBefore = structuredClone(approved.suggestion);
    freezeRecursively(approved);
    freezeRecursively(ledger);
    const posted = postJournalTransaction(approved, ledger);

    expect(posted.transaction.status).toBe("posted");
    expect(posted.transaction.suggestion).toBe(approved.suggestion);
    expect(posted.transaction.suggestion.entry).toBe(approved.suggestion.entry);
    expect(posted.transaction.suggestion.entry.lines).toBe(approved.suggestion.entry.lines);
    expect(posted.ledger.journalEntries).toHaveLength(1);
    expect(posted.ledger.journalEntries[0]).toBe(approved.suggestion.entry);
    expect(approved.suggestion).toEqual(evidenceBefore);
    expect(posted.ledger.journalEntries[0]).toEqual({
      ...metadata, description: rentMessage, currency: "KWD",
      lines: [
        { accountId: "rent-expense", debit: 600, credit: 0 },
        { accountId: "bank", debit: 0, credit: 600 },
      ],
    });
    expect(balance(posted.ledger, "rent-expense")).toMatchObject({ currency: "KWD", debitTotal: 600, creditTotal: 0, balance: 600 });
    expect(balance(posted.ledger, "bank")).toMatchObject({ currency: "KWD", debitTotal: 0, creditTotal: 600, balance: -600 });
    expect(posted.ledger.trialBalance).toMatchObject({ currency: "KWD", totalDebits: 600, totalCredits: 600, balanced: true });
    expect(ledger.journalEntries).toEqual([]);
    expect(balance(ledger, "bank").balance).toBe(0);
    expect(approved.status).toBe("approved");
  });

  it("updates existing balances, trial balance, and statements through Accounting Core across multiple posts", () => {
    const opening = capitalEntry();
    const ledger = createAccountingLedgerState([opening]);
    const rent = postJournalTransaction(approvedTransaction(), ledger);
    const utilities = postJournalTransaction(
      approvedTransaction("استلمت فاتورة كهرباء 120 د.ك وما دفعتها", "posted-utilities-2"),
      rent.ledger,
    );

    expect(rent.ledger.journalEntries[0]).toBe(opening);
    expect(balance(rent.ledger, "bank")).toMatchObject({ debitTotal: 1_000, creditTotal: 600, balance: 400 });
    expect(rent.ledger.trialBalance).toMatchObject({ totalDebits: 1_000, totalCredits: 1_000, balanced: true });
    expect(utilities.ledger.journalEntries).toHaveLength(3);
    expect(balance(utilities.ledger, "bank").balance).toBe(400);
    expect(balance(utilities.ledger, "rent-expense").balance).toBe(600);
    expect(balance(utilities.ledger, "utilities-expense").balance).toBe(120);
    expect(balance(utilities.ledger, "accounts-payable")).toMatchObject({ debitTotal: 0, creditTotal: 120, balance: 120 });
    expect(utilities.ledger.trialBalance).toMatchObject({ totalDebits: 1_120, totalCredits: 1_120, balanced: true });
    expect(utilities.ledger.profitAndLoss).toMatchObject({ currency: "KWD", totalRevenue: 0, totalExpenses: 720, netIncome: -720 });
    expect(utilities.ledger.balanceSheet).toMatchObject({ currency: "KWD", totalAssets: 400, totalLiabilities: 120, totalEquity: 1_000 });
    expect(rent.ledger.journalEntries).toHaveLength(2);
    expect(ledger.journalEntries).toEqual([opening]);
  });

  it("delegates validation and all derived accounting state to the existing core", () => {
    const approved = approvedTransaction();
    const ledger = createAccountingLedgerState();
    const validate = vi.spyOn(coreValidation, "assertValidJournalEntry");
    const balances = vi.spyOn(coreLedger, "calculateAccountBalances");
    const trialBalance = vi.spyOn(coreLedger, "createTrialBalance");
    const profitAndLoss = vi.spyOn(coreStatements, "classifyProfitAndLoss");
    const balanceSheet = vi.spyOn(coreStatements, "classifyBalanceSheet");
    const posted = postJournalTransaction(approved, ledger);

    expect(validate).toHaveBeenCalledWith(approved.suggestion.entry, DEFAULT_CHART_OF_ACCOUNTS);
    for (const calculation of [balances, trialBalance, profitAndLoss, balanceSheet]) {
      expect(calculation).toHaveBeenCalledWith(posted.ledger.journalEntries, DEFAULT_CHART_OF_ACCOUNTS);
    }
  });

  it("prevents repeated posting, including stale approved snapshots and cloned entries with the same ID", () => {
    const approved = approvedTransaction();
    const posted = postJournalTransaction(approved, createAccountingLedgerState());
    const before = structuredClone(posted.ledger);
    freezeRecursively(posted);
    const clonedApproved = structuredClone(approved);

    for (const transaction of [posted.transaction, approved, clonedApproved]) {
      expect(() => postJournalTransaction(transaction, posted.ledger)).toThrow(Error);
      expect(posted.ledger).toEqual(before);
    }
    expect(posted.ledger.journalEntries).toHaveLength(1);
    expect(balance(posted.ledger, "bank").creditTotal).toBe(600);
    expect(balance(posted.ledger, "rent-expense").debitTotal).toBe(600);
  });

  it.each([
    ["unbalanced lines", { lines: [{ accountId: "rent-expense", debit: 600, credit: 0 }, { accountId: "bank", debit: 0, credit: 599 }] }],
    ["unknown account", { lines: [{ accountId: "unknown-account", debit: 600, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 }] }],
    ["negative amounts", { lines: [{ accountId: "rent-expense", debit: -600, credit: 0 }, { accountId: "bank", debit: 0, credit: -600 }] }],
    ["non-finite amount", { lines: [{ accountId: "rent-expense", debit: Number.NaN, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 }] }],
    ["simultaneous debit and credit", { lines: [{ accountId: "rent-expense", debit: 600, credit: 1 }, { accountId: "bank", debit: 0, credit: 599 }] }],
    ["insufficient lines", { lines: [] }],
    ["missing currency", { currency: "" }],
    ["invalid currency", { currency: "kwd" }],
    ["mixed currency code", { currency: "KWD/USD" }],
  ] satisfies Array<[string, Partial<JournalEntry>]>)("rejects invalid journal data: %s", (_label, overrides) => {
    const approved = approvedTransaction();
    const invalid: JournalTransaction = {
      ...approved,
      suggestion: { ...approved.suggestion, entry: { ...approved.suggestion.entry, ...overrides } },
    };
    const ledger = createAccountingLedgerState([capitalEntry()]);
    const before = structuredClone(ledger);
    freezeRecursively(invalid);
    freezeRecursively(ledger);

    expect(() => postJournalTransaction(invalid, ledger)).toThrow(InvalidJournalEntryError);
    expect(invalid.status).toBe("approved");
    expect(ledger).toEqual(before);
  });

  it("uses the supplied chart to reject missing accounts without substituting them", () => {
    const approved = approvedTransaction();
    const chartWithoutBank = DEFAULT_CHART_OF_ACCOUNTS.filter(({ id }) => id !== "bank");
    const ledger = createAccountingLedgerState([], chartWithoutBank);

    expect(() => postJournalTransaction(approved, ledger, chartWithoutBank)).toThrow(InvalidJournalEntryError);
    expect(ledger.journalEntries).toEqual([]);
    expect(approved.suggestion.entry.lines[1].accountId).toBe("bank");
  });

  it("preserves a validated non-KWD currency without conversion", () => {
    const approved = approvedTransaction("Paid rent 600 USD from bank", "posted-usd-rent");
    const posted = postJournalTransaction(approved, createAccountingLedgerState());

    expect(posted.transaction.suggestion.entry.currency).toBe("USD");
    expect(posted.ledger.trialBalance).toMatchObject({ currency: "USD", totalDebits: 600, totalCredits: 600, balanced: true });
    expect(balance(posted.ledger, "rent-expense")).toMatchObject({ currency: "USD", balance: 600 });
  });

  it("rejects mixed currencies atomically using the existing ledger rule", () => {
    const approved = approvedTransaction("Paid rent 600 USD from bank", "posted-usd-rent");
    const ledger = createAccountingLedgerState([capitalEntry()]);
    const before = structuredClone(ledger);
    freezeRecursively(approved);
    freezeRecursively(ledger);

    expect(() => postJournalTransaction(approved, ledger)).toThrow(MixedCurrencyLedgerError);
    expect(approved.status).toBe("approved");
    expect(ledger).toEqual(before);
    expect(balance(ledger, "bank")).toMatchObject({ currency: "KWD", balance: 1_000 });
  });

  it.each(["", "   "])("rejects missing transaction IDs for ledger creation and posting: %j", (id) => {
    const approved = approvedTransaction();
    const invalid: JournalTransaction = {
      ...approved,
      suggestion: { ...approved.suggestion, entry: { ...approved.suggestion.entry, id } },
    };
    const ledger = createAccountingLedgerState();

    expect(() => createAccountingLedgerState([invalid.suggestion.entry])).toThrow(Error);
    expect(() => postJournalTransaction(invalid, ledger)).toThrow(Error);
    expect(ledger.journalEntries).toEqual([]);
  });

  it("rejects duplicate IDs, invalid entries, and mixed currencies when initializing ledger state", () => {
    const opening = capitalEntry();

    expect(() => createAccountingLedgerState([opening, structuredClone(opening)])).toThrow(Error);
    expect(() => createAccountingLedgerState([capitalEntry({ lines: [] })])).toThrow(InvalidJournalEntryError);
    expect(() => createAccountingLedgerState([opening, capitalEntry({ id: "usd-capital", currency: "USD" })])).toThrow(MixedCurrencyLedgerError);
  });
});

describe("explicit posting in chat", () => {
  it("posts only the selected approved suggestion and updates chat and ledger together", () => {
    const first = createSuggestedTransaction(suggestion());
    const second = approvedTransaction(rentMessage, "another-rent");
    const messages: ChatMessage[] = [
      { sender: "user", text: rentMessage },
      messageFor(first),
      { sender: "ai", text: "67,130 KWD" },
      messageFor(second),
    ];
    const state = createChatState(approveChatTransaction(messages, metadata.id));
    freezeRecursively(state);
    const posted = postChatTransaction(state, metadata.id);

    expect(posted.messages[1]).toMatchObject({ transaction: { status: "posted" } });
    expect(posted.messages[0]).toBe(state.messages[0]);
    expect(posted.messages[2]).toBe(state.messages[2]);
    expect(posted.messages[3]).toBe(state.messages[3]);
    expect(posted.messages[1].sender === "ai" && posted.messages[1].transaction?.suggestion).toBe(first.suggestion);
    expect(posted.ledger.journalEntries).toEqual([first.suggestion.entry]);
    expect(posted.postingError).toBeUndefined();
    expect(state.messages[1]).toMatchObject({ transaction: { status: "approved" } });
    expect(state.ledger.journalEntries).toEqual([]);
  });

  it.each(["draft", "awaiting_approval", "posted"] as const)("keeps chat and ledger unchanged for posting from %s", (status) => {
    const transaction: JournalTransaction = { status, suggestion: suggestion() };
    const state = createChatState([messageFor(transaction)]);
    freezeRecursively(state);
    const rejected = postChatTransaction(state, metadata.id);

    expect(rejected.messages).toBe(state.messages);
    expect(rejected.ledger).toBe(state.ledger);
    expect(rejected.postingError).toEqual(expect.any(String));
  });

  it("handles repeated clicks and stale approved snapshots without changing posted balances", () => {
    const approved = approvedTransaction();
    const state = createChatState([messageFor(approved)]);
    const posted = postChatTransaction(state, metadata.id);
    const repeated = postChatTransaction(posted, metadata.id);
    const stale = postChatTransaction({ ...posted, messages: state.messages }, metadata.id);

    expect(repeated.messages).toBe(posted.messages);
    expect(repeated.ledger).toBe(posted.ledger);
    expect(repeated.postingError).toEqual(expect.any(String));
    expect(stale.messages).toBe(state.messages);
    expect(stale.ledger).toBe(posted.ledger);
    expect(stale.postingError).toEqual(expect.any(String));
    expect(balance(stale.ledger, "rent-expense").debitTotal).toBe(600);
    expect(balance(stale.ledger, "bank").creditTotal).toBe(600);
  });

  it("rejects missing or ambiguous transaction IDs and clears an old error after a successful post", () => {
    const approved = approvedTransaction();
    const state = createChatState([messageFor(approved)]);
    const missing = postChatTransaction(state, "missing-entry");
    const ambiguousState = createChatState([messageFor(approved), messageFor(structuredClone(approved))]);
    const ambiguous = postChatTransaction(ambiguousState, metadata.id);

    expect(missing.messages).toBe(state.messages);
    expect(missing.ledger).toBe(state.ledger);
    expect(missing.postingError).toEqual(expect.any(String));
    expect(ambiguous.messages).toBe(ambiguousState.messages);
    expect(ambiguous.ledger).toBe(ambiguousState.ledger);
    expect(ambiguous.postingError).toEqual(expect.any(String));
    expect(postChatTransaction(missing, metadata.id).postingError).toBeUndefined();
  });

  it("leaves an invalid entry approved and the ledger unchanged when posting fails", () => {
    const approved = approvedTransaction();
    const invalid: JournalTransaction = {
      ...approved,
      suggestion: { ...approved.suggestion, entry: { ...approved.suggestion.entry, lines: [] } },
    };
    const state = createChatState([messageFor(invalid)]);
    const rejected = postChatTransaction(state, metadata.id);

    expect(rejected.messages).toBe(state.messages);
    expect(rejected.messages[0]).toMatchObject({ transaction: { status: "approved" } });
    expect(rejected.ledger).toBe(state.ledger);
    expect(rejected.postingError).toEqual(expect.any(String));
  });

  it("reports mixed-currency rejection without changing chat state or ledger balances", () => {
    const approved = approvedTransaction("Paid rent 600 USD from bank", "posted-usd-rent");
    const state = {
      ...createChatState([messageFor(approved)]),
      ledger: createAccountingLedgerState([capitalEntry()]),
    };
    freezeRecursively(state);
    const rejected = postChatTransaction(state, approved.suggestion.entry.id);

    expect(rejected.messages).toBe(state.messages);
    expect(rejected.ledger).toBe(state.ledger);
    expect(rejected.postingError).toEqual(expect.any(String));
    expect(balance(rejected.ledger, "bank").balance).toBe(1_000);
  });

  it("keeps posted entries in memory without changing uploaded data, writing storage, or sending requests", () => {
    const immutableDataset = structuredClone(dataset);
    const datasetBefore = structuredClone(immutableDataset);
    freezeRecursively(immutableDataset);
    const state = createChatState([messageFor(approvedTransaction())]);
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    const fetcher = vi.fn();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", { localStorage: storage, sessionStorage: storage });
    vi.stubGlobal("fetch", fetcher);
    const saveDataset = vi.spyOn(financialStore, "saveFinancialDataset");
    const posted = postChatTransaction(state, metadata.id);

    expect(posted.messages[0]).toMatchObject({ transaction: { status: "posted" } });
    expect(posted.ledger.journalEntries).toHaveLength(1);
    expect(immutableDataset).toEqual(datasetBefore);
    expect(saveDataset).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
    expect(createChatState([]).ledger.journalEntries).toEqual([]);
  });

  it.each([
    ["كم صافي الربح؟", "67,130 KWD"],
    ["شكثر المصاريف؟", "27,870 KWD"],
    ["شنو أكثر مصروف عندي؟", "16,550 KWD"],
  ] as const)("preserves deterministic financial Q&A after posting: %s", async (question, amount) => {
    const analyst = vi.fn();
    const before = await routeFinancialQuestion(question, dataset, analyst);
    const state = createChatState([messageFor(approvedTransaction())]);
    const posted = postChatTransaction(state, metadata.id);
    const after = await routeChatMessage(question, dataset, analyst, metadata);

    expect(posted.ledger.journalEntries).toHaveLength(1);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ route: "local", text: expect.stringContaining(amount) });
    expect(analyst).not.toHaveBeenCalled();
  });
});
