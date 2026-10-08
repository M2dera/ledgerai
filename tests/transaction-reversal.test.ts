import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { editJournalTransaction } from "@/lib/accounting/transaction-editing";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { createAccountingLedgerState, postJournalTransaction } from "@/lib/accounting/transaction-posting";
import { createJournalReversal, markJournalTransactionReversed } from "@/lib/accounting/transaction-reversal";
import { suggestJournalEntry, type SuggestedJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { createSuggestedTransaction, transitionJournalTransaction, type JournalTransaction } from "@/lib/accounting/transaction-workflow";
import type { JournalEntry } from "@/lib/accounting/types";
import { InvalidJournalEntryError } from "@/lib/accounting/validation";
import { analyzeData, createUploadedFile } from "@/lib/analysis/analyzer";
import { routeFinancialQuestion } from "@/lib/analysis/chat";
import { approveChatTransaction, createChatState, editChatTransaction, postChatTransaction, reverseChatTransaction, routeChatMessage, type ChatMessage, type ChatState } from "@/lib/chat";
import { readExcel } from "@/lib/excel/reader";
import type { FinancialDataset } from "@/lib/financial/types";
import * as financialStore from "@/lib/store/financialStore";

const originalId = "original-rent-700";
const reversalId = "reversal-rent-700";
const rentMessage = "دفعت إيجار 700 د.ك من البنك";
let dataset: FinancialDataset;

beforeAll(async () => {
  const bytes = await readFile("test-data/LedgerAI_test_financial_data.xlsx");
  const file = new File([bytes], "LedgerAI_test_financial_data.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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

function suggestion(id = originalId, message = rentMessage): SuggestedJournalEntry {
  const parsed = parseTransactionIntent(message);
  if (parsed.status !== "resolved") throw new Error("Expected a resolved transaction.");
  const result = suggestJournalEntry(parsed.intent, { id, date: "2026-10-08" });
  if (result.status !== "suggested") throw new Error("Expected a validated suggestion.");
  return result.suggestion;
}

function postedOriginal(ledger = createAccountingLedgerState(), entryOverrides: Partial<JournalEntry> = {}) {
  const proposed = suggestion();
  const reviewed = createSuggestedTransaction({ ...proposed, entry: { ...proposed.entry, ...entryOverrides } });
  return postJournalTransaction(transitionJournalTransaction(reviewed, "approved"), ledger);
}

function pendingReversal() {
  const original = postedOriginal();
  const reversal = createJournalReversal(originalId, [original.transaction], original.ledger, reversalId);
  return { original, reversal };
}

function completedReversal() {
  const pending = pendingReversal();
  const approved = transitionJournalTransaction(pending.reversal.transaction, "approved");
  const posted = postJournalTransaction(approved, pending.reversal.ledger);
  return { ...pending, posted };
}

function messageFor(transaction: JournalTransaction): ChatMessage {
  return { sender: "ai", text: "Accounting suggestion", transaction };
}

function transactions(state: ChatState): JournalTransaction[] {
  return state.messages.flatMap((message) => message.sender === "ai" && message.transaction ? [message.transaction] : []);
}

function findTransaction(state: ChatState, id: string): JournalTransaction {
  const transaction = transactions(state).find((current) => current.suggestion.entry.id === id);
  if (!transaction) throw new Error(`Missing transaction ${id}.`);
  return transaction;
}

function postedChatState(): ChatState {
  const approved = transitionJournalTransaction(createSuggestedTransaction(suggestion()), "approved");
  return postChatTransaction(createChatState([messageFor(approved)]), originalId);
}

function approveInChat(state: ChatState, id: string): ChatState {
  return { ...state, messages: approveChatTransaction(state.messages, id) };
}

function capitalEntry(): JournalEntry {
  return {
    id: "opening-capital",
    date: "2026-10-01",
    description: "Owner contribution",
    currency: "KWD",
    lines: [{ accountId: "bank", debit: 1_000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1_000 }],
  };
}

describe("creating a reversing journal transaction", () => {
  it("creates a new awaiting-approval transaction with an exact inverse and original reference", () => {
    const original = postedOriginal();
    const before = structuredClone(original);
    freezeRecursively(original);
    const reversal = createJournalReversal(originalId, [original.transaction], original.ledger, reversalId);

    expect(reversal.transaction.status).toBe("awaiting_approval");
    expect(reversal.transaction.reversalOfTransactionId).toBe(originalId);
    expect(reversal.transaction.suggestion.intent).toBe(original.transaction.suggestion.intent);
    expect(reversal.transaction.suggestion.entry).toEqual({
      id: reversalId,
      date: original.transaction.suggestion.entry.date,
      description: expect.stringMatching(/reversal/i),
      currency: "KWD",
      lines: [{ accountId: "rent-expense", debit: 0, credit: 700 }, { accountId: "bank", debit: 700, credit: 0 }],
    });
    expect(reversal.transaction.suggestion.entry.description).toContain(originalId);
    expect(reversal.transaction.suggestion.entry.id).not.toBe(originalId);
    expect(reversal.ledger.reversalReferences).toEqual([{ originalTransactionId: originalId, reversalTransactionId: reversalId }]);
    expect(reversal.ledger.journalEntries).toBe(original.ledger.journalEntries);
    expect(reversal.ledger.balances).toBe(original.ledger.balances);
    expect(reversal.ledger.trialBalance).toBe(original.ledger.trialBalance);
    expect(reversal.ledger.profitAndLoss).toBe(original.ledger.profitAndLoss);
    expect(reversal.ledger.balanceSheet).toBe(original.ledger.balanceSheet);
    expect(original).toEqual(before);
    expect(original.transaction.status).toBe("posted");
    expect(original.ledger.reversalReferences).toEqual([]);
  });

  it("swaps every line, including repeated accounts, without rounding decimal amounts", () => {
    const lines = [
      { accountId: "rent-expense", debit: 400.125, credit: 0 },
      { accountId: "rent-expense", debit: 300, credit: 0 },
      { accountId: "bank", debit: 0, credit: 650 },
      { accountId: "cash", debit: 0, credit: 50.125 },
    ];
    const original = postedOriginal(createAccountingLedgerState(), { lines });
    const reversal = createJournalReversal(originalId, [original.transaction], original.ledger, reversalId);

    expect(reversal.transaction.suggestion.entry.lines).toEqual(lines.map(({ accountId, debit, credit }) => ({ accountId, debit: credit, credit: debit })));
    expect(reversal.transaction.suggestion.entry.lines).not.toBe(lines);
    expect(reversal.transaction.suggestion.entry.lines[0]).not.toBe(lines[0]);
    expect(reversal.transaction.suggestion.entry.currency).toBe(original.transaction.suggestion.entry.currency);
  });

  it("preserves an explicitly posted USD currency", () => {
    const reviewed = createSuggestedTransaction(suggestion(originalId, "Paid rent 700.125 USD from bank"));
    const original = postJournalTransaction(transitionJournalTransaction(reviewed, "approved"), createAccountingLedgerState());
    const reversal = createJournalReversal(originalId, [original.transaction], original.ledger, reversalId);

    expect(reversal.transaction.suggestion.entry.currency).toBe("USD");
    expect(reversal.transaction.suggestion.entry.lines).toEqual([{ accountId: "rent-expense", debit: 0, credit: 700.125 }, { accountId: "bank", debit: 700.125, credit: 0 }]);
  });

  it.each(["draft", "awaiting_approval", "approved", "reversed"] as const)("rejects an original in %s even if its ID appears in the ledger", (status) => {
    const original = postedOriginal();
    const transaction: JournalTransaction = { ...original.transaction, status };
    freezeRecursively(original.ledger);

    expect(() => createJournalReversal(originalId, [transaction], original.ledger, reversalId)).toThrow(Error);
    expect(original.ledger.journalEntries).toHaveLength(1);
    expect(original.ledger.reversalReferences).toEqual([]);
  });

  it("rejects missing originals in transactions or the authoritative posted ledger", () => {
    const original = postedOriginal();
    expect(() => createJournalReversal("missing", [original.transaction], original.ledger, reversalId)).toThrow(Error);
    expect(() => createJournalReversal(originalId, [], original.ledger, reversalId)).toThrow(Error);
    expect(() => createJournalReversal(originalId, [original.transaction], createAccountingLedgerState(), reversalId)).toThrow(Error);
  });

  it("rejects ambiguous original transaction IDs", () => {
    const original = postedOriginal();
    expect(() => createJournalReversal(originalId, [original.transaction, structuredClone(original.transaction)], original.ledger, reversalId)).toThrow(Error);
  });

  it.each(["", "   ", originalId])("rejects invalid or colliding reversal ID %j", (id) => {
    const original = postedOriginal();
    expect(() => createJournalReversal(originalId, [original.transaction], original.ledger, id)).toThrow(Error);
  });

  it("rejects a new ID already present in an unposted transaction or another posted entry", () => {
    const original = postedOriginal(createAccountingLedgerState([capitalEntry()]));
    const other = createSuggestedTransaction(suggestion(reversalId));
    expect(() => createJournalReversal(originalId, [original.transaction, other], original.ledger, reversalId)).toThrow(Error);
    expect(() => createJournalReversal(originalId, [original.transaction], original.ledger, "opening-capital")).toThrow(Error);
  });

  it("rejects stale or altered original evidence instead of reversing different data", () => {
    const original = postedOriginal();
    const altered: JournalTransaction = {
      ...original.transaction,
      suggestion: { ...original.transaction.suggestion, entry: { ...original.transaction.suggestion.entry, lines: [{ accountId: "rent-expense", debit: 701, credit: 0 }, { accountId: "bank", debit: 0, credit: 701 }] } },
    };
    expect(() => createJournalReversal(originalId, [altered], original.ledger, reversalId)).toThrow(Error);
    expect(original.ledger.journalEntries[0].lines[0].debit).toBe(700);
  });

  it.each([
    ["unbalanced original", { lines: [{ accountId: "rent-expense", debit: 700, credit: 0 }, { accountId: "bank", debit: 0, credit: 699 }] }],
    ["unknown account", { lines: [{ accountId: "missing-account", debit: 700, credit: 0 }, { accountId: "bank", debit: 0, credit: 700 }] }],
    ["invalid currency", { currency: "kwd" }],
    ["missing currency", { currency: "" }],
    ["non-finite amount", { lines: [{ accountId: "rent-expense", debit: Number.POSITIVE_INFINITY, credit: 0 }, { accountId: "bank", debit: 0, credit: 700 }] }],
    ["missing lines", { lines: [] }],
  ] satisfies Array<[string, Partial<JournalEntry>]>)("rejects %s through Accounting Core", (_label, overrides) => {
    const original = postedOriginal();
    const entry = { ...original.transaction.suggestion.entry, ...overrides };
    const invalid: JournalTransaction = { ...original.transaction, suggestion: { ...original.transaction.suggestion, entry } };
    const ledger = { ...original.ledger, journalEntries: [entry] };
    freezeRecursively(ledger);

    expect(() => createJournalReversal(originalId, [invalid], ledger, reversalId)).toThrow(InvalidJournalEntryError);
    expect(ledger.reversalReferences).toEqual([]);
  });

  it("validates against the supplied chart and refuses missing account references", () => {
    const original = postedOriginal();
    const accounts = DEFAULT_CHART_OF_ACCOUNTS.filter(({ id }) => id !== "bank");
    expect(() => createJournalReversal(originalId, [original.transaction], original.ledger, reversalId, accounts)).toThrow(InvalidJournalEntryError);
  });
});

describe("approval, posting, and immutable original evidence", () => {
  it("requires explicit approval and posting, then offsets every account and marks only workflow metadata", () => {
    const { original, reversal } = pendingReversal();
    const originalEntry = original.transaction.suggestion.entry;
    const before = structuredClone(originalEntry);
    freezeRecursively(original);
    freezeRecursively(reversal);

    expect(() => postJournalTransaction(reversal.transaction, reversal.ledger)).toThrow(Error);
    expect(() => markJournalTransactionReversed(original.transaction, reversal.ledger)).toThrow(Error);
    const approved = transitionJournalTransaction(reversal.transaction, "approved");
    expect(approved.status).toBe("approved");
    expect(approved.reversalOfTransactionId).toBe(originalId);
    expect(original.transaction.status).toBe("posted");
    expect(reversal.ledger.journalEntries).toHaveLength(1);
    const posted = postJournalTransaction(approved, reversal.ledger);
    const marked = markJournalTransactionReversed(original.transaction, posted.ledger);

    expect(posted.transaction.status).toBe("posted");
    expect(posted.ledger.journalEntries).toHaveLength(2);
    expect(posted.ledger.journalEntries[0]).toBe(originalEntry);
    expect(posted.ledger.journalEntries[1]).toBe(approved.suggestion.entry);
    expect(posted.ledger.balances.every(({ balance }) => balance === 0)).toBe(true);
    expect(posted.ledger.trialBalance).toMatchObject({ currency: "KWD", totalDebits: 0, totalCredits: 0, balanced: true });
    expect(posted.ledger.profitAndLoss).toMatchObject({ totalRevenue: 0, totalExpenses: 0, netIncome: 0 });
    expect(marked).toMatchObject({ status: "reversed", reversedByTransactionId: reversalId });
    expect(marked.suggestion).toBe(original.transaction.suggestion);
    expect(marked.suggestion.entry).toBe(originalEntry);
    expect(marked.suggestion.entry.lines).toBe(originalEntry.lines);
    expect(originalEntry).toEqual(before);
    expect(original.transaction.status).toBe("posted");
    expect(original.transaction).not.toHaveProperty("reversedByTransactionId");
  });

  it("restores unrelated ledger balances and financial statements to their original baseline", () => {
    const baseline = createAccountingLedgerState([capitalEntry()]);
    const original = postedOriginal(baseline);
    const reversal = createJournalReversal(originalId, [original.transaction], original.ledger, reversalId);
    const posted = postJournalTransaction(transitionJournalTransaction(reversal.transaction, "approved"), reversal.ledger);

    expect(posted.ledger.balances.map(({ account, balance }) => ({ id: account.id, balance }))).toEqual(baseline.balances.map(({ account, balance }) => ({ id: account.id, balance })));
    expect(posted.ledger.trialBalance).toEqual(baseline.trialBalance);
    expect(posted.ledger.profitAndLoss.netIncome).toBe(baseline.profitAndLoss.netIncome);
    expect(posted.ledger.balanceSheet.totalAssets).toBe(baseline.balanceSheet.totalAssets);
    expect(posted.ledger.balanceSheet.totalEquity).toBe(baseline.balanceSheet.totalEquity);
    expect(posted.ledger.journalEntries[0]).toBe(baseline.journalEntries[0]);
    expect(posted.ledger.journalEntries).toHaveLength(3);
  });

  it("retains pending reversal reservations when an unrelated transaction is posted", () => {
    const { original, reversal } = pendingReversal();
    const other = transitionJournalTransaction(createSuggestedTransaction(suggestion("other-rent", "Paid rent 200 KWD from cash")), "approved");
    const posted = postJournalTransaction(other, reversal.ledger);

    expect(posted.ledger.reversalReferences).toEqual(reversal.ledger.reversalReferences);
    expect(() => createJournalReversal(originalId, [original.transaction], posted.ledger, "second-reversal")).toThrow(Error);
    const completed = postJournalTransaction(transitionJournalTransaction(reversal.transaction, "approved"), posted.ledger);
    expect(completed.ledger.balances.find(({ account }) => account.id === "rent-expense")?.balance).toBe(200);
  });

  it.each(["posted", "reversed"] as const)("keeps the %s original non-editable", (status) => {
    const { original, posted } = completedReversal();
    const transaction: JournalTransaction = status === "reversed" ? markJournalTransactionReversed(original.transaction, posted.ledger) : original.transaction;
    const candidate = { ...transaction.suggestion.entry, description: "Attempted edit" };
    expect(() => editJournalTransaction(transaction, candidate, posted.ledger)).toThrow(Error);
    expect(original.transaction.suggestion.entry.description).toBe(rentMessage);
  });

  it("keeps the posted reversal non-editable", () => {
    const { posted } = completedReversal();
    expect(() => editJournalTransaction(posted.transaction, { ...posted.transaction.suggestion.entry, description: "Attempted edit" }, posted.ledger)).toThrow(Error);
  });

  it("preserves normal unposted editing, reference metadata, and renewed approval", () => {
    const { reversal } = pendingReversal();
    const approved = transitionJournalTransaction(reversal.transaction, "approved");
    const entry = { ...approved.suggestion.entry, date: "2026-10-09", description: "Reviewed reversal description" };
    const edited = editJournalTransaction(approved, entry, reversal.ledger);

    expect(edited.status).toBe("awaiting_approval");
    expect(edited.reversalOfTransactionId).toBe(originalId);
    expect(edited.suggestion.entry).toEqual(entry);
    expect(postJournalTransaction(transitionJournalTransaction(edited, "approved"), reversal.ledger).transaction.status).toBe("posted");
  });
});

describe("duplicate and circular reversal protection", () => {
  it("rejects repeated creation and a stale posted original while the first reversal is pending", () => {
    const { original, reversal } = pendingReversal();
    expect(() => createJournalReversal(originalId, [original.transaction, reversal.transaction], reversal.ledger, "another-reversal")).toThrow(Error);
    expect(() => createJournalReversal(originalId, [structuredClone(original.transaction)], reversal.ledger, "stale-reversal")).toThrow(Error);
    expect(reversal.ledger.journalEntries).toHaveLength(1);
    expect(reversal.ledger.reversalReferences).toHaveLength(1);
  });

  it("rejects completed reversal creation using stale original metadata and a new ID", () => {
    const { original, posted } = completedReversal();
    expect(() => createJournalReversal(originalId, [original.transaction], posted.ledger, "second-completed-reversal")).toThrow(Error);
    expect(posted.ledger.journalEntries).toHaveLength(2);
  });

  it("rejects repeated posting and a stale approved reversal after completion", () => {
    const { reversal, posted } = completedReversal();
    const staleApproved = transitionJournalTransaction(reversal.transaction, "approved");
    expect(() => postJournalTransaction(posted.transaction, posted.ledger)).toThrow(Error);
    expect(() => postJournalTransaction(staleApproved, posted.ledger)).toThrow(Error);
    expect(posted.ledger.journalEntries).toHaveLength(2);
  });

  it("rejects another reversal posting for the same original with a different transaction ID", () => {
    const { reversal, posted } = completedReversal();
    const duplicate: JournalTransaction = { ...transitionJournalTransaction(reversal.transaction, "approved"), suggestion: { ...reversal.transaction.suggestion, entry: { ...reversal.transaction.suggestion.entry, id: "different-reversal" } } };
    expect(() => postJournalTransaction(duplicate, posted.ledger)).toThrow(Error);
  });

  it("prevents a posted reversal itself being reversed, including stripped stale metadata", () => {
    const { posted } = completedReversal();
    const stripped: JournalTransaction = { status: "posted", suggestion: posted.transaction.suggestion };
    expect(() => createJournalReversal(reversalId, [posted.transaction], posted.ledger, "circular-reversal")).toThrow(Error);
    expect(() => createJournalReversal(reversalId, [stripped], posted.ledger, "stripped-circular-reversal")).toThrow(Error);
  });

  it.each([undefined, "different-original", reversalId])("rejects missing, changed, or self-referencing metadata %j for a reserved reversal", (reference) => {
    const { reversal } = pendingReversal();
    const approved: JournalTransaction = { ...transitionJournalTransaction(reversal.transaction, "approved"), reversalOfTransactionId: reference };
    expect(() => postJournalTransaction(approved, reversal.ledger)).toThrow(Error);
    expect(reversal.ledger.journalEntries).toHaveLength(1);
  });

  it("rejects reversal metadata without a matching ledger reservation", () => {
    const { original, reversal } = pendingReversal();
    expect(() => postJournalTransaction(transitionJournalTransaction(reversal.transaction, "approved"), original.ledger)).toThrow(Error);
  });

  it("rejects posting if the reserved original is missing from the ledger", () => {
    const { reversal } = pendingReversal();
    const ledger = { ...createAccountingLedgerState(), reversalReferences: reversal.ledger.reversalReferences };
    expect(() => postJournalTransaction(transitionJournalTransaction(reversal.transaction, "approved"), ledger)).toThrow(Error);
  });

  it.each([
    ["amounts", { lines: [{ accountId: "rent-expense", debit: 0, credit: 701 }, { accountId: "bank", debit: 701, credit: 0 }] }],
    ["accounts", { lines: [{ accountId: "rent-expense", debit: 0, credit: 700 }, { accountId: "cash", debit: 700, credit: 0 }] }],
    ["currency", { currency: "USD" }],
    ["direction", { lines: [{ accountId: "rent-expense", debit: 700, credit: 0 }, { accountId: "bank", debit: 0, credit: 700 }] }],
    ["extra line", { lines: [{ accountId: "rent-expense", debit: 0, credit: 700 }, { accountId: "bank", debit: 700, credit: 0 }, { accountId: "cash", debit: 0, credit: 0 }] }],
  ] satisfies Array<[string, Partial<JournalEntry>]>)("rejects valid-looking reversal with changed %s rather than posting a non-offsetting entry", (_label, overrides) => {
    const { original, reversal } = pendingReversal();
    const approved: JournalTransaction = { ...transitionJournalTransaction(reversal.transaction, "approved"), suggestion: { ...reversal.transaction.suggestion, entry: { ...reversal.transaction.suggestion.entry, ...overrides } } };
    const before = structuredClone(reversal.ledger);
    freezeRecursively(reversal.ledger);

    expect(() => postJournalTransaction(approved, reversal.ledger)).toThrow(Error);
    expect(reversal.ledger).toEqual(before);
    expect(original.transaction.status).toBe("posted");
  });
});

describe("explicit reversal in chat", () => {
  it("appends a reviewable reversal without changing the original message or accounting balances", () => {
    const state = postedChatState();
    const original = findTransaction(state, originalId);
    freezeRecursively(state);
    const reversed = reverseChatTransaction(state, originalId, reversalId);

    expect(reversed.reversalError).toBeUndefined();
    expect(reversed.messages).toHaveLength(state.messages.length + 1);
    expect(reversed.messages[0]).toBe(state.messages[0]);
    expect(findTransaction(reversed, originalId)).toBe(original);
    expect(findTransaction(reversed, originalId).status).toBe("posted");
    expect(findTransaction(reversed, reversalId)).toMatchObject({ status: "awaiting_approval", reversalOfTransactionId: originalId });
    expect(reversed.ledger.journalEntries).toBe(state.ledger.journalEntries);
    expect(reversed.ledger.balances).toBe(state.ledger.balances);
  });

  it("marks the original reversed atomically only after the new entry is explicitly approved and posted", () => {
    const state = postedChatState();
    const original = findTransaction(state, originalId);
    const originalEntry = original.suggestion.entry;
    const reversed = reverseChatTransaction(state, originalId, reversalId);
    const premature = postChatTransaction(reversed, reversalId);
    expect(premature.postingError).toEqual(expect.any(String));
    expect(premature.messages).toBe(reversed.messages);
    expect(premature.ledger).toBe(reversed.ledger);
    const approved = approveInChat(reversed, reversalId);
    expect(findTransaction(approved, originalId).status).toBe("posted");
    expect(findTransaction(approved, reversalId).status).toBe("approved");
    const posted = postChatTransaction(approved, reversalId);

    expect(posted.postingError).toBeUndefined();
    expect(findTransaction(posted, originalId)).toMatchObject({ status: "reversed", reversedByTransactionId: reversalId });
    expect(findTransaction(posted, reversalId)).toMatchObject({ status: "posted", reversalOfTransactionId: originalId });
    expect(findTransaction(posted, originalId).suggestion).toBe(original.suggestion);
    expect(posted.ledger.journalEntries[0]).toBe(originalEntry);
    expect(posted.ledger.journalEntries).toHaveLength(2);
    expect(posted.ledger.balances.every(({ balance }) => balance === 0)).toBe(true);
    expect(findTransaction(state, originalId).status).toBe("posted");
  });

  it("rejects duplicate creation from repeated actions and stale messages with the current pending ledger", () => {
    const state = postedChatState();
    const reversed = reverseChatTransaction(state, originalId, reversalId);
    const repeated = reverseChatTransaction(reversed, originalId, "repeated-reversal");
    const staleState = { ...reversed, messages: state.messages };
    const stale = reverseChatTransaction(staleState, originalId, "stale-reversal");

    expect(repeated.reversalError).toEqual(expect.any(String));
    expect(repeated.messages).toBe(reversed.messages);
    expect(repeated.ledger).toBe(reversed.ledger);
    expect(stale.reversalError).toEqual(expect.any(String));
    expect(stale.messages).toBe(state.messages);
    expect(stale.ledger).toBe(reversed.ledger);
    expect(stale.ledger.reversalReferences).toHaveLength(1);
  });

  it("rejects completed duplicate creation and stale approved reversal posting with the current ledger", () => {
    const state = postedChatState();
    const pending = reverseChatTransaction(state, originalId, reversalId);
    const approved = approveInChat(pending, reversalId);
    const posted = postChatTransaction(approved, reversalId);
    const staleOriginal = reverseChatTransaction({ ...posted, messages: state.messages }, originalId, "stale-completed-reversal");
    const staleApproved = postChatTransaction({ ...posted, messages: approved.messages }, reversalId);

    expect(staleOriginal.reversalError).toEqual(expect.any(String));
    expect(staleOriginal.messages).toBe(state.messages);
    expect(staleOriginal.ledger).toBe(posted.ledger);
    expect(staleApproved.postingError).toEqual(expect.any(String));
    expect(staleApproved.messages).toBe(approved.messages);
    expect(staleApproved.ledger).toBe(posted.ledger);
    expect(posted.ledger.journalEntries).toHaveLength(2);
  });

  it.each(["draft", "awaiting_approval", "approved"] as const)("rejects Reverse on a %s chat transaction", (status) => {
    const state = createChatState([messageFor({ status, suggestion: suggestion() })]);
    const rejected = reverseChatTransaction(state, originalId, reversalId);
    expect(rejected.reversalError).toEqual(expect.any(String));
    expect(rejected.messages).toBe(state.messages);
    expect(rejected.ledger).toBe(state.ledger);
  });

  it("rejects missing and ambiguous chat originals without changing chat or ledger", () => {
    const state = postedChatState();
    const missing = reverseChatTransaction(state, "missing", reversalId);
    const ambiguousState = { ...state, messages: [...state.messages, messageFor(structuredClone(findTransaction(state, originalId)))] };
    const ambiguous = reverseChatTransaction(ambiguousState, originalId, reversalId);
    expect(missing.reversalError).toEqual(expect.any(String));
    expect(missing.messages).toBe(state.messages);
    expect(missing.ledger).toBe(state.ledger);
    expect(ambiguous.reversalError).toEqual(expect.any(String));
    expect(ambiguous.messages).toBe(ambiguousState.messages);
    expect(ambiguous.ledger).toBe(state.ledger);
  });

  it("keeps the original posted and all ledger balances unchanged when a modified reversal fails posting", () => {
    const state = postedChatState();
    const pending = reverseChatTransaction(state, originalId, reversalId);
    const reversal = findTransaction(pending, reversalId);
    const edited = editChatTransaction(pending, reversalId, { ...reversal.suggestion.entry, lines: [{ accountId: "rent-expense", debit: 0, credit: 701 }, { accountId: "bank", debit: 701, credit: 0 }] });
    expect(edited.editingError).toBeUndefined();
    const approved = approveInChat(edited, reversalId);
    const rejected = postChatTransaction(approved, reversalId);

    expect(rejected.postingError).toEqual(expect.any(String));
    expect(rejected.messages).toBe(approved.messages);
    expect(rejected.ledger).toBe(approved.ledger);
    expect(findTransaction(rejected, originalId).status).toBe("posted");
    expect(findTransaction(rejected, reversalId).status).toBe("approved");
    expect(rejected.ledger.journalEntries).toHaveLength(1);
    expect(rejected.ledger.balances.find(({ account }) => account.id === "rent-expense")?.balance).toBe(700);
  });

  it("retains session-only behavior without storage writes, requests, or uploaded dataset changes", () => {
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
    const pending = reverseChatTransaction(postedChatState(), originalId, reversalId);
    const posted = postChatTransaction(approveInChat(pending, reversalId), reversalId);

    expect(findTransaction(posted, originalId).status).toBe("reversed");
    expect(posted.ledger.journalEntries).toHaveLength(2);
    expect(immutableDataset).toEqual(before);
    expect(saveDataset).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
    expect(createChatState([]).ledger.journalEntries).toEqual([]);
    expect(createChatState([]).ledger.reversalReferences).toEqual([]);
  });

  it.each([
    ["كم صافي الربح؟", "67,130 KWD"],
    ["شكثر المصاريف؟", "27,870 KWD"],
    ["شنو أكثر مصروف عندي؟", "16,550 KWD"],
  ] as const)("preserves deterministic financial Q&A after completed reversal: %s", async (question, amount) => {
    const analyst = vi.fn();
    const before = await routeFinancialQuestion(question, dataset, analyst);
    const pending = reverseChatTransaction(postedChatState(), originalId, reversalId);
    const posted = postChatTransaction(approveInChat(pending, reversalId), reversalId);
    const after = await routeChatMessage(question, dataset, analyst, { id: "financial-answer", date: "2026-10-08" });

    expect(findTransaction(posted, originalId).status).toBe("reversed");
    expect(after).toEqual(before);
    expect(after).toMatchObject({ route: "local", text: expect.stringContaining(amount) });
    expect(analyst).not.toHaveBeenCalled();
  });
});
