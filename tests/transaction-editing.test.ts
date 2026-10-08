import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { MixedCurrencyLedgerError } from "@/lib/accounting/ledger";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { editJournalTransaction } from "@/lib/accounting/transaction-editing";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { createAccountingLedgerState, postJournalTransaction, type AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, transitionJournalTransaction, type JournalTransaction } from "@/lib/accounting/transaction-workflow";
import type { Account, JournalEntry, JournalEntryValidationError } from "@/lib/accounting/types";
import { InvalidJournalEntryError } from "@/lib/accounting/validation";
import * as coreValidation from "@/lib/accounting/validation";
import { analyzeData, createUploadedFile } from "@/lib/analysis/analyzer";
import { routeFinancialQuestion } from "@/lib/analysis/chat";
import { approveChatTransaction, createChatState, editChatTransaction, postChatTransaction, routeChatMessage, type ChatMessage, type ChatState } from "@/lib/chat";
import { readExcel } from "@/lib/excel/reader";
import type { FinancialDataset } from "@/lib/financial/types";
import * as financialStore from "@/lib/store/financialStore";

const metadata = { id: "editable-rent-1", date: "2026-10-08" };
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

function transaction(status: JournalTransaction["status"] = "awaiting_approval", id = metadata.id): JournalTransaction {
  const parsed = parseTransactionIntent("Paid rent 600 KWD from bank");
  if (parsed.status !== "resolved") throw new Error("Expected a resolved transaction intent.");
  const result = suggestJournalEntry(parsed.intent, { ...metadata, id });
  if (result.status !== "suggested") throw new Error("Expected a validated journal suggestion.");
  return { ...createSuggestedTransaction(result.suggestion), status };
}

function edit(entry: JournalEntry, overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    ...entry,
    date: "2026-10-09",
    description: "Corrected rent payment from cash",
    lines: [
      { accountId: "rent-expense", debit: 725.125, credit: 0 },
      { accountId: "cash", debit: 0, credit: 725.125 },
    ],
    ...overrides,
  };
}

function capitalEntry(): JournalEntry {
  return {
    id: "opening-capital",
    date: "2026-10-01",
    description: "Owner contribution",
    currency: "KWD",
    lines: [
      { accountId: "bank", debit: 1_000, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: 1_000 },
    ],
  };
}

function balance(ledger: AccountingLedgerState, accountId: string) {
  const result = ledger.balances.find(({ account }) => account.id === accountId);
  if (!result) throw new Error(`Missing ledger account ${accountId}.`);
  return result;
}

function messageFor(value: JournalTransaction): ChatMessage {
  return { sender: "ai", text: "Accounting suggestion", transaction: value };
}

describe("editing an unposted journal transaction", () => {
  it.each(["awaiting_approval", "approved"] as const)("validates a %s edit, preserves its ID and evidence, and requires approval", (status) => {
    const original = transaction(status);
    const candidate = edit(original.suggestion.entry);
    const ledger = createAccountingLedgerState([capitalEntry()]);
    const before = structuredClone({ original, candidate, ledger });
    freezeRecursively(original);
    freezeRecursively(candidate);
    freezeRecursively(ledger);

    const edited = editJournalTransaction(original, candidate, ledger);

    expect(edited.status).toBe("awaiting_approval");
    expect(edited.suggestion.entry).toEqual(candidate);
    expect(edited.suggestion.entry.id).toBe(original.suggestion.entry.id);
    expect(edited.suggestion.intent).toBe(original.suggestion.intent);
    expect(edited).not.toBe(original);
    expect(edited.suggestion).not.toBe(original.suggestion);
    expect(edited.suggestion.entry).not.toBe(candidate);
    expect(edited.suggestion.entry.lines).not.toBe(candidate.lines);
    expect(edited.suggestion.entry.lines[0]).not.toBe(candidate.lines[0]);
    expect({ original, candidate, ledger }).toEqual(before);
    expect(balance(ledger, "bank").balance).toBe(1_000);
    expect(balance(ledger, "rent-expense").balance).toBe(0);
    expect(balance(ledger, "cash").balance).toBe(0);
  });

  it("isolates the saved entry from subsequent mutations of the caller's draft", () => {
    const original = transaction();
    const candidate = edit(original.suggestion.entry);
    const expected = structuredClone(candidate);
    const edited = editJournalTransaction(original, candidate, createAccountingLedgerState());

    candidate.description = "Unsaved draft mutation";
    candidate.lines[0].debit = 999;
    candidate.lines.push({ accountId: "bank", debit: 0, credit: 1 });

    expect(edited.suggestion.entry).toEqual(expected);
    expect(original.suggestion.entry.description).toBe("Paid rent 600 KWD from bank");
    expect(original.suggestion.entry.lines[0].debit).toBe(600);
  });

  it.each(["draft", "posted"] as const)("rejects an edit on a %s transaction without changing any evidence or balances", (status) => {
    const original = transaction(status);
    const ledger = createAccountingLedgerState([capitalEntry()]);
    const candidate = edit(original.suggestion.entry);
    const before = structuredClone({ original, ledger, candidate });
    freezeRecursively(original);
    freezeRecursively(ledger);

    expect(() => editJournalTransaction(original, candidate, ledger)).toThrow(Error);
    expect({ original, ledger, candidate }).toEqual(before);
  });

  it.each(["awaiting_approval", "approved"] as const)("rejects a stale %s snapshot when its ID is already posted", (status) => {
    const original = transaction(status);
    const posted = postJournalTransaction(transaction("approved"), createAccountingLedgerState());
    const before = structuredClone(posted.ledger);
    freezeRecursively(posted.ledger);

    expect(() => editJournalTransaction(original, edit(original.suggestion.entry), posted.ledger)).toThrow(Error);
    expect(posted.ledger).toEqual(before);
    expect(balance(posted.ledger, "rent-expense").balance).toBe(600);
    expect(balance(posted.ledger, "bank").balance).toBe(-600);
  });

  it.each([
    ["unbalanced lines", { lines: [{ accountId: "rent-expense", debit: 600, credit: 0 }, { accountId: "bank", debit: 0, credit: 599 }] }],
    ["unknown account", { lines: [{ accountId: "unknown-account", debit: 600, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 }] }],
    ["negative amounts", { lines: [{ accountId: "rent-expense", debit: -600, credit: 0 }, { accountId: "bank", debit: 0, credit: -600 }] }],
    ["non-finite debit", { lines: [{ accountId: "rent-expense", debit: Number.NaN, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 }] }],
    ["non-finite credit", { lines: [{ accountId: "rent-expense", debit: 600, credit: 0 }, { accountId: "bank", debit: 0, credit: Number.POSITIVE_INFINITY }] }],
    ["simultaneous debit and credit", { lines: [{ accountId: "rent-expense", debit: 600, credit: 1 }, { accountId: "bank", debit: 0, credit: 599 }] }],
    ["missing lines", { lines: [] }],
    ["only one line", { lines: [{ accountId: "bank", debit: 0, credit: 0 }] }],
    ["missing currency", { currency: "" }],
    ["invalid currency", { currency: "kwd" }],
    ["combined currency", { currency: "KWD/USD" }],
  ] satisfies Array<[string, Partial<JournalEntry>]>)("rejects %s through Accounting Core and keeps the approved entry unchanged", (_label, overrides) => {
    const original = transaction("approved");
    const candidate = edit(original.suggestion.entry, overrides);
    const ledger = createAccountingLedgerState([capitalEntry()]);
    const before = structuredClone({ original, ledger, candidate });
    freezeRecursively(original);
    freezeRecursively(ledger);
    freezeRecursively(candidate);

    expect(() => editJournalTransaction(original, candidate, ledger)).toThrow(InvalidJournalEntryError);
    expect({ original, ledger, candidate }).toEqual(before);
    expect(original.status).toBe("approved");
  });

  it.each([
    ["changed transaction ID", { id: "replacement-id" }],
    ["empty transaction ID", { id: "" }],
    ["blank transaction ID", { id: "   " }],
    ["empty description", { description: "" }],
    ["blank description", { description: "   " }],
    ["missing date", { date: "" }],
    ["ambiguous date format", { date: "10/09/2026" }],
    ["timestamp instead of date", { date: "2026-10-09T00:00:00Z" }],
    ["invalid day", { date: "2026-04-31" }],
    ["non-leap February", { date: "2026-02-29" }],
    ["invalid month", { date: "2026-13-01" }],
    ["zero year", { date: "0000-01-01" }],
  ] satisfies Array<[string, Partial<JournalEntry>]>)("rejects %s without applying the draft", (_label, overrides) => {
    const original = transaction("approved");
    const candidate = edit(original.suggestion.entry, overrides);
    const ledger = createAccountingLedgerState();
    const before = structuredClone({ original, ledger, candidate });

    expect(() => editJournalTransaction(original, candidate, ledger)).toThrow(Error);
    expect({ original, ledger, candidate }).toEqual(before);
  });

  it("accepts a valid leap-day edit", () => {
    const original = transaction();
    const candidate = edit(original.suggestion.entry, { date: "2028-02-29" });

    expect(editJournalTransaction(original, candidate, createAccountingLedgerState()).suggestion.entry.date).toBe("2028-02-29");
  });

  it("runs Accounting Core validation and surfaces its rejection before saving", () => {
    const original = transaction("approved");
    const candidate = edit(original.suggestion.entry);
    const ledger = createAccountingLedgerState();
    const errors: JournalEntryValidationError[] = [{ code: "UNBALANCED_ENTRY", message: "Core rejected the edited entry." }];
    const validator = vi.spyOn(coreValidation, "assertValidJournalEntry").mockImplementation(() => {
      throw new InvalidJournalEntryError(errors);
    });

    expect(() => editJournalTransaction(original, candidate, ledger)).toThrow("Core rejected the edited entry.");
    expect(validator).toHaveBeenCalledWith(candidate, DEFAULT_CHART_OF_ACCOUNTS);
    expect(original.status).toBe("approved");
    expect(original.suggestion.entry.lines[0].debit).toBe(600);
    expect(ledger.journalEntries).toEqual([]);
  });

  it.each([
    ["currency surrounded by whitespace", { currency: " KWD " }],
    ["a zero-value line", { lines: [
      { accountId: "rent-expense", debit: 600, credit: 0 },
      { accountId: "bank", debit: 0, credit: 600 },
      { accountId: "cash", debit: 0, credit: 0 },
    ] }],
    ["an entirely zero-value entry", { lines: [
      { accountId: "rent-expense", debit: 0, credit: 0 },
      { accountId: "bank", debit: 0, credit: 0 },
    ] }],
    ["missing line records", { lines: new Array<JournalEntry["lines"][number]>(2) }],
    ["line-specific mixed currencies", { lines: [
      { accountId: "rent-expense", debit: 600, credit: 0, currency: "KWD" },
      { accountId: "bank", debit: 0, credit: 600, currency: "USD" },
    ] as unknown as JournalEntry["lines"] }],
    ["overflowed totals", { lines: [
      { accountId: "rent-expense", debit: Number.MAX_VALUE, credit: 0 },
      { accountId: "cash", debit: Number.MAX_VALUE, credit: 0 },
      { accountId: "bank", debit: 0, credit: Number.MAX_VALUE },
      { accountId: "accounts-payable", debit: 0, credit: Number.MAX_VALUE },
    ] }],
  ] satisfies Array<[string, Partial<JournalEntry>]>)("rejects %s before applying a saved edit", (_label, overrides) => {
    const original = transaction("approved");
    const ledger = createAccountingLedgerState([capitalEntry()]);
    const candidate = edit(original.suggestion.entry, overrides);
    const before = structuredClone({ original, ledger, candidate });

    expect(() => editJournalTransaction(original, candidate, ledger)).toThrow(Error);
    expect({ original, ledger, candidate }).toEqual(before);
  });

  it("validates against a supplied chart, accepting its accounts and rejecting missing accounts", () => {
    const original = transaction();
    const customAccount: Account = { id: "custom-expense", code: "5090", name: "Custom Expense", type: "expense" };
    const accounts: readonly Account[] = [...DEFAULT_CHART_OF_ACCOUNTS, customAccount];
    const candidate = edit(original.suggestion.entry, {
      lines: [
        { accountId: customAccount.id, debit: 50, credit: 0 },
        { accountId: "bank", debit: 0, credit: 50 },
      ],
    });
    const ledger = createAccountingLedgerState([], accounts);

    expect(editJournalTransaction(original, candidate, ledger, accounts).suggestion.entry).toEqual(candidate);
    expect(() => editJournalTransaction(original, candidate, ledger)).toThrow(InvalidJournalEntryError);
    const withoutBank = accounts.filter(({ id }) => id !== "bank");
    expect(() => editJournalTransaction(original, candidate, ledger, withoutBank)).toThrow(InvalidJournalEntryError);
    expect(ledger.journalEntries).toEqual([]);
  });

  it("rejects a currency edit that conflicts with the posted ledger without changing balances", () => {
    const original = transaction("approved");
    const candidate = edit(original.suggestion.entry, { currency: "USD" });
    const ledger = createAccountingLedgerState([capitalEntry()]);
    const before = structuredClone({ original, ledger });
    freezeRecursively(original);
    freezeRecursively(ledger);

    expect(() => editJournalTransaction(original, candidate, ledger)).toThrow(MixedCurrencyLedgerError);
    expect({ original, ledger }).toEqual(before);
    expect(balance(ledger, "bank")).toMatchObject({ currency: "KWD", balance: 1_000 });
  });

  it("allows another valid currency in an empty ledger and preserves it through approval and posting", () => {
    const original = transaction();
    const ledger = createAccountingLedgerState();
    const edited = editJournalTransaction(original, edit(original.suggestion.entry, { currency: "USD" }), ledger);
    const approved = transitionJournalTransaction(edited, "approved");
    const posted = postJournalTransaction(approved, ledger);

    expect(edited.status).toBe("awaiting_approval");
    expect(edited.suggestion.entry.currency).toBe("USD");
    expect(ledger.journalEntries).toEqual([]);
    expect(posted.ledger.trialBalance).toMatchObject({ currency: "USD", totalDebits: 725.125, totalCredits: 725.125, balanced: true });
  });
});

describe("saving journal edits in chat", () => {
  it("replaces only the selected transaction after validation and retains the entire ledger by reference", () => {
    const first = transaction("approved");
    const second = transaction("approved", "other-entry");
    const messages: ChatMessage[] = [
      { sender: "user", text: "Paid rent 600 KWD from bank" },
      messageFor(first),
      { sender: "ai", text: "67,130 KWD" },
      messageFor(second),
    ];
    const state: ChatState = {
      ...createChatState(messages),
      ledger: createAccountingLedgerState([capitalEntry()]),
      editingError: { transactionId: metadata.id, message: "Previous invalid edit" },
    };
    const before = structuredClone(state);
    freezeRecursively(state);
    const candidate = edit(first.suggestion.entry);

    const edited = editChatTransaction(state, metadata.id, candidate);

    expect(edited.messages[1]).toMatchObject({ transaction: { status: "awaiting_approval", suggestion: { entry: candidate } } });
    for (const index of [0, 2, 3]) expect(edited.messages[index]).toBe(state.messages[index]);
    expect(edited.ledger).toBe(state.ledger);
    expect(edited.ledger.balances).toBe(state.ledger.balances);
    expect(edited.ledger.trialBalance).toBe(state.ledger.trialBalance);
    expect(edited.ledger.profitAndLoss).toBe(state.ledger.profitAndLoss);
    expect(edited.ledger.balanceSheet).toBe(state.ledger.balanceSheet);
    expect(edited.editingError).toBeUndefined();
    expect(state).toEqual(before);
  });

  it.each(["awaiting_approval", "approved"] as const)("leaves a %s entry and ledger unchanged after an invalid Save", (status) => {
    const original = transaction(status);
    const state = createChatState([messageFor(original)]);
    freezeRecursively(state);

    const rejected = editChatTransaction(state, metadata.id, edit(original.suggestion.entry, { lines: [] }));

    expect(rejected.messages).toBe(state.messages);
    expect(rejected.ledger).toBe(state.ledger);
    expect(rejected.messages[0]).toMatchObject({ transaction: { status, suggestion: original.suggestion } });
    expect(rejected.editingError).toEqual({ transactionId: metadata.id, message: expect.any(String) });
  });

  it("rejects missing and ambiguous transaction IDs without applying a draft", () => {
    const original = transaction();
    const candidate = edit(original.suggestion.entry);
    const state = createChatState([messageFor(original)]);
    const ambiguousState = createChatState([messageFor(original), messageFor(structuredClone(original))]);

    for (const [source, id] of [[state, "missing-entry"], [ambiguousState, metadata.id]] as const) {
      const rejected = editChatTransaction(source, id, candidate);
      expect(rejected.messages).toBe(source.messages);
      expect(rejected.ledger).toBe(source.ledger);
      expect(rejected.editingError).toEqual({ transactionId: id, message: expect.any(String) });
    }
  });

  it("rejects a posted entry and a stale approved snapshot without changing posted balances", () => {
    const original = transaction("approved");
    const state = createChatState([messageFor(original)]);
    const posted = postChatTransaction(state, metadata.id);
    const stale = { ...posted, messages: state.messages };
    const before = structuredClone(posted.ledger);
    freezeRecursively(posted);

    for (const source of [posted, stale]) {
      const rejected = editChatTransaction(source, metadata.id, edit(original.suggestion.entry));
      expect(rejected.messages).toBe(source.messages);
      expect(rejected.ledger).toBe(posted.ledger);
      expect(rejected.ledger).toEqual(before);
      expect(rejected.editingError).toEqual({ transactionId: metadata.id, message: expect.any(String) });
    }
    expect(posted.messages[0]).toMatchObject({ transaction: { status: "posted" } });
    expect(balance(posted.ledger, "rent-expense").balance).toBe(600);
  });

  it("rejects a mixed-currency Save atomically", () => {
    const original = transaction("approved");
    const state: ChatState = { ...createChatState([messageFor(original)]), ledger: createAccountingLedgerState([capitalEntry()]) };
    const before = structuredClone(state);
    freezeRecursively(state);

    const rejected = editChatTransaction(state, metadata.id, edit(original.suggestion.entry, { currency: "USD" }));

    expect(rejected.messages).toBe(state.messages);
    expect(rejected.ledger).toBe(state.ledger);
    expect(state).toEqual(before);
    expect(rejected.editingError).toEqual({ transactionId: metadata.id, message: expect.any(String) });
  });

  it.each(["awaiting_approval", "approved"] as const)("allows an edited %s entry to be approved and posted exactly once with the edited amounts", (status) => {
    const original = transaction(status);
    const state = createChatState([messageFor(original)]);
    const candidate = edit(original.suggestion.entry);
    const edited = editChatTransaction(state, metadata.id, candidate);
    const prematurePost = postChatTransaction(edited, metadata.id);

    expect(prematurePost.messages).toBe(edited.messages);
    expect(prematurePost.ledger).toBe(edited.ledger);
    expect(prematurePost.postingError).toEqual(expect.any(String));

    const approved = { ...edited, messages: approveChatTransaction(edited.messages, metadata.id) };
    expect(approved.messages[0]).toMatchObject({ transaction: { status: "approved", suggestion: { entry: candidate } } });
    expect(approved.ledger.journalEntries).toEqual([]);
    const posted = postChatTransaction(approved, metadata.id);

    expect(posted.messages[0]).toMatchObject({ transaction: { status: "posted", suggestion: { entry: candidate } } });
    expect(posted.ledger.journalEntries).toEqual([candidate]);
    expect(posted.ledger.journalEntries[0].id).toBe(metadata.id);
    expect(balance(posted.ledger, "rent-expense").balance).toBe(725.125);
    expect(balance(posted.ledger, "cash").balance).toBe(-725.125);
    expect(balance(posted.ledger, "bank").balance).toBe(0);
    expect(posted.ledger.trialBalance).toMatchObject({ totalDebits: 725.125, totalCredits: 725.125, balanced: true });
    expect(posted.ledger.profitAndLoss).toMatchObject({ totalExpenses: 725.125, netIncome: -725.125 });
    expect(posted.postingError).toBeUndefined();
    expect(postChatTransaction(posted, metadata.id).ledger).toBe(posted.ledger);
    expect(edited.ledger.journalEntries).toEqual([]);
  });

  it("saves edits only in memory without storage writes, requests, or uploaded-data changes", () => {
    const original = transaction();
    const state = createChatState([messageFor(original)]);
    const immutableDataset = structuredClone(dataset);
    const before = structuredClone(immutableDataset);
    freezeRecursively(immutableDataset);
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    const fetcher = vi.fn();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", { localStorage: storage, sessionStorage: storage });
    vi.stubGlobal("fetch", fetcher);
    const saveDataset = vi.spyOn(financialStore, "saveFinancialDataset");

    const edited = editChatTransaction(state, metadata.id, edit(original.suggestion.entry));
    const rejected = editChatTransaction(edited, metadata.id, edit(original.suggestion.entry, { lines: [] }));

    expect(edited.messages[0]).toMatchObject({ transaction: { status: "awaiting_approval" } });
    expect(rejected.messages).toBe(edited.messages);
    expect(edited.ledger).toBe(state.ledger);
    expect(immutableDataset).toEqual(before);
    expect(saveDataset).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
    expect(createChatState([]).ledger.journalEntries).toEqual([]);
  });

  it.each([
    ["What is my profit?", "67,130 KWD"],
    ["What are total expenses?", "27,870 KWD"],
    ["What is my highest expense?", "16,550 KWD"],
  ] as const)("preserves uploaded-data financial Q&A before and after editing and posting: %s", async (question, amount) => {
    const analyst = vi.fn();
    const immutableDataset = structuredClone(dataset);
    const beforeDataset = structuredClone(immutableDataset);
    freezeRecursively(immutableDataset);
    const before = await routeFinancialQuestion(question, immutableDataset, analyst);
    const original = transaction("approved");
    const state = createChatState([messageFor(original)]);
    const edited = editChatTransaction(state, metadata.id, edit(original.suggestion.entry));
    const afterEdit = await routeChatMessage(question, immutableDataset, analyst, metadata);
    const approved = { ...edited, messages: approveChatTransaction(edited.messages, metadata.id) };
    const posted = postChatTransaction(approved, metadata.id);
    const afterPost = await routeChatMessage(question, immutableDataset, analyst, metadata);

    expect(edited.ledger.journalEntries).toEqual([]);
    expect(posted.ledger.journalEntries).toHaveLength(1);
    expect(afterEdit).toEqual(before);
    expect(afterPost).toEqual(before);
    expect(afterPost).toMatchObject({ route: "local", text: expect.stringContaining(amount) });
    expect(immutableDataset).toEqual(beforeDataset);
    expect(analyst).not.toHaveBeenCalled();
  });
});
