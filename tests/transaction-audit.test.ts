import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { captureAuditContext, getTransactionAuditEvents, type AuditContext } from "@/lib/accounting/audit-trail";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { editJournalTransaction } from "@/lib/accounting/transaction-editing";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { createAccountingLedgerState, postJournalTransaction } from "@/lib/accounting/transaction-posting";
import { createJournalReversal, markJournalTransactionReversed } from "@/lib/accounting/transaction-reversal";
import { suggestJournalEntry, type SuggestedJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { createDraftTransaction, createSuggestedTransaction, transitionJournalTransaction, type JournalTransaction } from "@/lib/accounting/transaction-workflow";
import type { JournalEntry } from "@/lib/accounting/types";
import { analyzeData, createUploadedFile } from "@/lib/analysis/analyzer";
import { routeFinancialQuestion } from "@/lib/analysis/chat";
import { approveChatTransaction, createChatState, editChatTransaction, postChatTransaction, reverseChatTransaction, routeChatMessage, type ChatMessage, type ChatState } from "@/lib/chat";
import { readExcel } from "@/lib/excel/reader";
import type { FinancialDataset } from "@/lib/financial/types";
import * as financialStore from "@/lib/store/financialStore";

const originalId = "audit-rent-original";
const reversalId = "audit-rent-reversal";
let dataset: FinancialDataset;

beforeAll(async () => {
  const bytes = await readFile("test-data/LedgerAI_test_financial_data.xlsx");
  const file = new File([bytes], "LedgerAI_test_financial_data.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  dataset = analyzeData(await readExcel(file), createUploadedFile(file));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function context(second: number): AuditContext {
  return Object.freeze({ timestamp: `2026-10-08T09:00:${String(second).padStart(2, "0")}.000Z` });
}

function suggestion(id = originalId): SuggestedJournalEntry {
  const parsed = parseTransactionIntent("Paid rent 700.125 KWD from bank");
  if (parsed.status !== "resolved") throw new Error("Expected a resolved accounting intent.");
  const result = suggestJournalEntry(parsed.intent, { id, date: "2026-10-01" });
  if (result.status !== "suggested") throw new Error("Expected a validated journal suggestion.");
  return result.suggestion;
}

function reviewed(id = originalId): JournalTransaction {
  return createSuggestedTransaction(suggestion(id), context(0));
}

function approved(id = originalId): JournalTransaction {
  return transitionJournalTransaction(reviewed(id), "approved", undefined, context(1));
}

function postedOriginal() {
  return postJournalTransaction(approved(), createAccountingLedgerState(), undefined, context(2));
}

function pendingReversal() {
  const original = postedOriginal();
  const reversal = createJournalReversal(originalId, [original.transaction], original.ledger, reversalId, undefined, context(3));
  return { original, reversal };
}

function completedReversal() {
  const pending = pendingReversal();
  const approvedReversal = transitionJournalTransaction(pending.reversal.transaction, "approved", undefined, context(4));
  const posted = postJournalTransaction(approvedReversal, pending.reversal.ledger, undefined, context(5));
  const original = markJournalTransactionReversed(pending.reversal.originalTransaction, posted.ledger, undefined, context(5));
  return { ...pending, approvedReversal, posted, original, originalBefore: pending.original.transaction };
}

function events(transaction: JournalTransaction) {
  return transaction.auditEvents ?? [];
}

function types(transaction: JournalTransaction) {
  return events(transaction).map((event) => event.type);
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

function approveInChat(state: ChatState, id: string, second = 1): ChatState {
  return { ...state, messages: approveChatTransaction(state.messages, id, context(second)) };
}

function postedChatState(): ChatState {
  const state = createChatState([messageFor(reviewed())]);
  return postChatTransaction(approveInChat(state, originalId), originalId, context(2));
}

function edit(entry: JournalEntry): JournalEntry {
  return {
    ...entry,
    date: "2026-10-02",
    description: "Corrected rent payment from cash",
    lines: [
      { accountId: "rent-expense", debit: 725.125, credit: 0 },
      { accountId: "cash", debit: 0, credit: 725.125 },
    ],
  };
}

function freezeRecursively(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

function expectFrozenRecursively(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(expectFrozenRecursively);
}

describe("transaction lifecycle audit events", () => {
  it.each(["draft", "awaiting_approval"] as const)("records creation in %s without replacing accounting evidence", (status) => {
    const proposed = suggestion();
    const transaction = status === "draft"
      ? createDraftTransaction(proposed, context(0))
      : createSuggestedTransaction(proposed, context(0));

    expect(transaction.suggestion).toBe(proposed);
    expect(types(transaction)).toEqual(status === "draft" ? ["transaction_created"] : ["transaction_created", "transaction_submitted_for_approval"]);
    expect(events(transaction)[0]).toMatchObject({
      id: expect.any(String), transactionId: originalId, type: "transaction_created",
      timestamp: context(0).timestamp, previousStatus: null, newStatus: "draft",
      metadata: { entry: proposed.entry },
    });
    expect(events(transaction)[0]).not.toHaveProperty("relatedTransactionId");
    expect(events(transaction)[0].metadata).not.toHaveProperty("intent");
  });

  it("records draft submission and explicit approval as separate transitions", () => {
    const draft = createDraftTransaction(suggestion(), context(0));
    const review = transitionJournalTransaction(draft, "awaiting_approval", undefined, context(1));
    const approvedTransaction = transitionJournalTransaction(review, "approved", undefined, context(2));

    expect(types(approvedTransaction)).toEqual([
      "transaction_created", "transaction_submitted_for_approval", "transaction_approved",
    ]);
    expect(events(review)[1]).toMatchObject({ previousStatus: "draft", newStatus: "awaiting_approval", timestamp: context(1).timestamp });
    expect(events(approvedTransaction)[2]).toMatchObject({
      transactionId: originalId, previousStatus: "awaiting_approval", newStatus: "approved", timestamp: context(2).timestamp,
    });
    expect(approvedTransaction.suggestion).toBe(draft.suggestion);
    expect(events(draft)).toHaveLength(1);
    expect(events(review)).toHaveLength(2);
    expect(events(approvedTransaction)[0]).toBe(events(draft)[0]);
  });

  it("records submission exactly once across suggested creation, approval, editing, reapproval, and posting", () => {
    let state = createChatState([messageFor(reviewed())]);
    const submitted = events(findTransaction(state, originalId))[1];
    expect(submitted).toMatchObject({
      id: `${originalId}:audit:2`, type: "transaction_submitted_for_approval",
      previousStatus: "draft", newStatus: "awaiting_approval", timestamp: context(0).timestamp,
    });
    expectFrozenRecursively(submitted);
    state = approveInChat(state, originalId, 1);
    state = editChatTransaction(state, originalId, edit(findTransaction(state, originalId).suggestion.entry), context(2));
    state = approveInChat(state, originalId, 3);
    state = postChatTransaction(state, originalId, context(4));
    const final = findTransaction(state, originalId);

    expect(types(final)).toEqual([
      "transaction_created", "transaction_submitted_for_approval", "transaction_approved",
      "transaction_edited", "transaction_approved", "transaction_posted",
    ]);
    expect(events(final).filter(({ type }) => type === "transaction_submitted_for_approval")).toEqual([submitted]);
    expect(events(final)[1]).toBe(submitted);
    expect(state.postingError).toBeUndefined();
    expect(state.ledger.journalEntries[0]).toBe(final.suggestion.entry);
  });

  it("rejects repeated submission without appending events or mutating the existing history", () => {
    const proposed = suggestion();
    const transaction = createSuggestedTransaction(proposed, context(0));
    const history = events(transaction);
    freezeRecursively(transaction);

    expect(() => transitionJournalTransaction(transaction, "awaiting_approval", undefined, context(1))).toThrow();
    expect(events(transaction)).toBe(history);
    expect(types(transaction)).toEqual(["transaction_created", "transaction_submitted_for_approval"]);
    // Replaying creation with the same inputs returns the same two records, never a duplicated submission.
    const replay = createSuggestedTransaction(proposed, context(0));
    expect(events(replay)).toEqual(history);
    expect(events(replay).filter(({ type }) => type === "transaction_submitted_for_approval")).toHaveLength(1);
  });

  it("records a successful post after Accounting Core has produced the ledger", () => {
    const original = approved();
    const ledger = createAccountingLedgerState();
    const posted = postJournalTransaction(original, ledger, undefined, context(2));

    expect(types(posted.transaction)).toEqual(["transaction_created", "transaction_submitted_for_approval", "transaction_approved", "transaction_posted"]);
    expect(events(posted.transaction)[3]).toMatchObject({
      transactionId: originalId, timestamp: context(2).timestamp,
      previousStatus: "approved", newStatus: "posted", metadata: { entry: original.suggestion.entry },
    });
    expect(posted.transaction.suggestion).toBe(original.suggestion);
    expect(posted.ledger.journalEntries[0]).toBe(original.suggestion.entry);
    expect(posted.ledger.balances.find(({ account }) => account.id === "rent-expense")?.balance).toBe(700.125);
    expect(posted.ledger.balances.find(({ account }) => account.id === "bank")?.balance).toBe(-700.125);
    expect(events(original)).toHaveLength(3);
    expect(ledger.journalEntries).toEqual([]);
  });

  it.each(["awaiting_approval", "approved"] as const)("records complete before/after journal state when editing %s", (status) => {
    const original = status === "approved" ? approved() : reviewed();
    const before = structuredClone(original.suggestion.entry);
    const candidate = edit(original.suggestion.entry);
    const ledger = createAccountingLedgerState();
    const edited = editJournalTransaction(original, candidate, ledger, undefined, context(3));
    const last = events(edited).at(-1);

    expect(last).toMatchObject({
      type: "transaction_edited", transactionId: originalId, timestamp: context(3).timestamp,
      previousStatus: status, newStatus: "awaiting_approval", metadata: { before, after: candidate },
    });
    expect(edited.suggestion.intent).toBe(original.suggestion.intent);
    expect(original.suggestion.entry).toEqual(before);
    expect(ledger.journalEntries).toEqual([]);
    expect(edited.status).toBe("awaiting_approval");
    expect(types(transitionJournalTransaction(edited, "approved", undefined, context(4))).at(-1)).toBe("transaction_approved");
  });

  it("accepts legacy transaction objects without inventing historical creation events", () => {
    const legacy: JournalTransaction = { status: "awaiting_approval", suggestion: suggestion() };
    const next = transitionJournalTransaction(legacy, "approved", undefined, context(1));

    expect(types(next)).toEqual(["transaction_approved"]);
    expect(next.suggestion).toBe(legacy.suggestion);
    expect(legacy).not.toHaveProperty("auditEvents");
  });
});

describe("immutable deterministic session audit histories", () => {
  it("creates repeatable event IDs and timestamps from the same operation inputs", () => {
    const first = completedReversal();
    const replay = completedReversal();
    const allEvents = [...events(first.original), ...events(first.posted.transaction)];

    expect(events(first.original)).toEqual(events(replay.original));
    expect(events(first.posted.transaction)).toEqual(events(replay.posted.transaction));
    expect(new Set(allEvents.map(({ id }) => id)).size).toBe(allEvents.length);
    expect(allEvents.every(({ timestamp }) => /^2026-10-08T09:00:\d{2}\.000Z$/.test(timestamp))).toBe(true);
    expect(allEvents.every(({ timestamp }) => !timestamp.startsWith(first.original.suggestion.entry.date))).toBe(true);
  });

  it("captures a frozen actual UTC action timestamp that can be reused for an atomic operation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T09:04:02.456Z"));
    const captured = captureAuditContext();
    const transaction = createSuggestedTransaction(suggestion(), captured);

    expect(captured).toEqual({ timestamp: "2026-10-08T09:04:02.456Z" });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(events(transaction)[0].timestamp).toBe(captured.timestamp);
  });

  it("freezes all event objects, lists, metadata, journal snapshots, and snapshot lines", () => {
    const original = approved();
    const edited = editJournalTransaction(original, edit(original.suggestion.entry), createAccountingLedgerState(), undefined, context(3));

    expectFrozenRecursively(edited.auditEvents);
    const firstEvent = events(edited)[0];
    expect(Reflect.set(firstEvent, "type", "transaction_posted")).toBe(false);
    expect(Reflect.set(edited.auditEvents!, "0", { ...firstEvent, type: "transaction_posted" })).toBe(false);
    expect(types(edited)).toEqual(["transaction_created", "transaction_submitted_for_approval", "transaction_approved", "transaction_edited"]);
  });

  it("isolates creation snapshots from later mutations of the original suggestion", () => {
    const proposed = suggestion();
    const expected = structuredClone(proposed.entry);
    const transaction = createSuggestedTransaction(proposed, context(0));
    const created = events(transaction)[0];
    if (created.type !== "transaction_created") throw new Error("Expected a creation event.");

    expect(created.metadata.entry).not.toBe(proposed.entry);
    expect(created.metadata.entry.lines).not.toBe(proposed.entry.lines);
    proposed.entry.description = "Later caller mutation";
    proposed.entry.lines[0].debit = 1;
    proposed.entry.lines.push({ accountId: "cash", debit: 0, credit: 1 });

    expect(created.metadata.entry).toEqual(expected);
    expect(Reflect.set(created.metadata.entry.lines[0], "debit", 999)).toBe(false);
  });

  it("isolates both edit snapshots from caller drafts and subsequent edits", () => {
    const original = reviewed();
    const before = structuredClone(original.suggestion.entry);
    const candidate = edit(original.suggestion.entry);
    const expectedAfter = structuredClone(candidate);
    const edited = editJournalTransaction(original, candidate, createAccountingLedgerState(), undefined, context(3));
    const saved = events(edited).at(-1);
    if (saved?.type !== "transaction_edited") throw new Error("Expected an edit event.");
    const nextCandidate = { ...edited.suggestion.entry, description: "Second correction" };
    const next = editJournalTransaction(edited, nextCandidate, createAccountingLedgerState(), undefined, context(4));

    candidate.description = "Unsaved change";
    candidate.lines[0].debit = 999;
    original.suggestion.entry.description = "Caller mutated old entry";

    expect(saved.metadata.before).toEqual(before);
    expect(saved.metadata.after).toEqual(expectedAfter);
    expect(saved.metadata.before).not.toBe(original.suggestion.entry);
    expect(saved.metadata.after).not.toBe(edited.suggestion.entry);
    expect(events(next).at(-2)).toBe(saved);
    expectFrozenRecursively(saved);
  });

  it("continues a deeply frozen history without mutating previous transaction versions", () => {
    const original = reviewed();
    const snapshot = structuredClone(original);
    freezeRecursively(original);
    const approvedTransaction = transitionJournalTransaction(original, "approved", undefined, context(1));
    freezeRecursively(approvedTransaction);
    const posted = postJournalTransaction(approvedTransaction, createAccountingLedgerState(), undefined, context(2));

    expect(original).toEqual(snapshot);
    expect(events(posted.transaction)[0]).toBe(events(original)[0]);
    expect(events(posted.transaction)).toHaveLength(4);
    expectFrozenRecursively(posted.transaction.auditEvents);
  });
});

describe("linked reversal audit events", () => {
  it("records reversal creation only on the original without changing its posted entry or ledger balances", () => {
    const { original, reversal } = pendingReversal();
    const creation = events(reversal.transaction)[0];
    const linkedCreation = events(reversal.originalTransaction).at(-1);

    expect(types(reversal.transaction)).toEqual(["transaction_created"]);
    expect(creation).toMatchObject({
      type: "transaction_created", transactionId: reversalId, relatedTransactionId: originalId,
      timestamp: context(3).timestamp, previousStatus: null, newStatus: "awaiting_approval",
      metadata: { entry: reversal.transaction.suggestion.entry },
    });
    expect(linkedCreation).toMatchObject({
      type: "transaction_reversal_created", transactionId: originalId, relatedTransactionId: reversalId,
      timestamp: creation.timestamp, previousStatus: "posted", newStatus: "posted",
      metadata: { entry: reversal.originalTransaction.suggestion.entry },
    });
    expect(types(reversal.originalTransaction)).toEqual([
      "transaction_created", "transaction_submitted_for_approval", "transaction_approved", "transaction_posted",
      "transaction_reversal_created",
    ]);
    expect(reversal.originalTransaction.status).toBe("posted");
    expect(reversal.originalTransaction.suggestion).toBe(original.transaction.suggestion);
    expect(reversal.originalTransaction.suggestion.entry).toBe(original.ledger.journalEntries[0]);
    expect(original.transaction.status).toBe("posted");
    expect(types(original.transaction)).toEqual(["transaction_created", "transaction_submitted_for_approval", "transaction_approved", "transaction_posted"]);
    for (const [index, event] of events(original.transaction).entries()) {
      expect(events(reversal.originalTransaction)[index]).toBe(event);
    }
    expectFrozenRecursively(linkedCreation);
    expectFrozenRecursively(creation);
    expect(reversal.ledger.balances).toBe(original.ledger.balances);
    expect(reversal.ledger.journalEntries).toBe(original.ledger.journalEntries);
  });

  it("records exactly one of each own lifecycle event and keeps specialized reversal events exclusively on the original", () => {
    const completed = completedReversal();
    const originalEntry = completed.original.suggestion.entry;

    expect(types(completed.original)).toEqual([
      "transaction_created", "transaction_submitted_for_approval", "transaction_approved", "transaction_posted",
      "transaction_reversal_created", "transaction_reversal_posted", "transaction_marked_reversed",
    ]);
    expect(types(completed.posted.transaction)).toEqual([
      "transaction_created", "transaction_approved", "transaction_posted",
    ]);
    for (const type of ["transaction_reversal_created", "transaction_reversal_posted", "transaction_marked_reversed"] as const) {
      expect(events(completed.original).filter((event) => event.type === type)).toHaveLength(1);
      expect(events(completed.posted.transaction).filter((event) => event.type === type)).toHaveLength(0);
    }
    for (const type of ["transaction_created", "transaction_approved", "transaction_posted"] as const) {
      expect(events(completed.posted.transaction).filter((event) => event.type === type)).toHaveLength(1);
    }
    expect(events(completed.original).every((event) => event.transactionId === originalId)).toBe(true);
    expect(events(completed.posted.transaction).every((event) => event.transactionId === reversalId && event.relatedTransactionId === originalId)).toBe(true);
    expect(events(completed.original).at(-2)).toMatchObject({
      type: "transaction_reversal_posted", transactionId: originalId, relatedTransactionId: reversalId,
      previousStatus: "posted", newStatus: "posted", timestamp: context(5).timestamp,
      metadata: { entry: originalEntry },
    });
    expect(events(completed.original).at(-1)).toMatchObject({
      type: "transaction_marked_reversed", transactionId: originalId, relatedTransactionId: reversalId,
      previousStatus: "posted", newStatus: "reversed", timestamp: context(5).timestamp,
    });
    expect(events(completed.posted.transaction).at(-1)).toMatchObject({
      type: "transaction_posted", transactionId: reversalId, relatedTransactionId: originalId,
      previousStatus: "approved", newStatus: "posted", timestamp: context(5).timestamp,
    });
    expect(events(completed.original).slice(0, 5)).toEqual(events(completed.reversal.originalTransaction));
    expect(events(completed.reversal.originalTransaction)).toHaveLength(5);
    expectFrozenRecursively(completed.original.auditEvents);
    expectFrozenRecursively(completed.posted.transaction.auditEvents);
    expect(completed.original.suggestion.entry).toBe(completed.originalBefore.suggestion.entry);
    expect(originalEntry).toEqual(completed.originalBefore.suggestion.entry);
    expect(originalEntry).toEqual(suggestion().entry);
    expect(completed.posted.ledger.journalEntries[0]).toBe(originalEntry);
    expect(completed.posted.ledger.journalEntries).toHaveLength(2);
    expect(completed.posted.ledger.balances.every(({ balance }) => balance === 0)).toBe(true);
    expect(completed.posted.ledger.trialBalance.totalDebits).toBe(0);
    expect(completed.posted.ledger.trialBalance.totalCredits).toBe(0);
    expect(completed.posted.ledger.profitAndLoss.netIncome).toBe(0);
  });

  it("selects each transaction's own events exactly once while excluding related and unrelated histories", () => {
    const completed = completedReversal();
    const unrelated = reviewed("unrelated-audit-transaction");
    const allTransactions = [completed.original, completed.posted.transaction, unrelated,
      completed.originalBefore, completed.reversal.originalTransaction, completed.approvedReversal,
      { ...completed.original }, { ...completed.posted.transaction }];
    const originalHistory = getTransactionAuditEvents(originalId, allTransactions);
    const reversalHistory = getTransactionAuditEvents(reversalId, allTransactions);

    expect(originalHistory.map(({ type }) => type)).toEqual([
      "transaction_created", "transaction_submitted_for_approval", "transaction_approved", "transaction_posted", "transaction_reversal_created",
      "transaction_reversal_posted", "transaction_marked_reversed",
    ]);
    expect(reversalHistory.map(({ type }) => type)).toEqual([
      "transaction_created", "transaction_approved", "transaction_posted",
    ]);
    expect(originalHistory.every(({ transactionId }) => transactionId === originalId)).toBe(true);
    expect(reversalHistory.every(({ transactionId }) => transactionId === reversalId)).toBe(true);
    expect(new Set(originalHistory.map(({ id }) => id)).size).toBe(originalHistory.length);
    expect(new Set(reversalHistory.map(({ id }) => id)).size).toBe(reversalHistory.length);
    expect(originalHistory).toEqual(events(completed.original));
    expect(reversalHistory).toEqual(events(completed.posted.transaction));
    expect(originalHistory.slice(-3).map(({ relatedTransactionId }) => relatedTransactionId)).toEqual([reversalId, reversalId, reversalId]);
    expect(originalHistory.slice(-3).map(({ timestamp }) => timestamp)).toEqual([context(3).timestamp, context(5).timestamp, context(5).timestamp]);
    expect(reversalHistory.map(({ timestamp }) => timestamp)).toEqual([context(3).timestamp, context(4).timestamp, context(5).timestamp]);
    expectFrozenRecursively(originalHistory);
    expectFrozenRecursively(reversalHistory);
    expect(getTransactionAuditEvents("missing", allTransactions)).toEqual([]);
  });

  it("appends linked actions to frozen legacy histories without changing prior transaction copies", () => {
    const posted = postedOriginal();
    const legacy: JournalTransaction = { status: "posted", suggestion: posted.transaction.suggestion };
    freezeRecursively(legacy);
    const reversal = createJournalReversal(originalId, [legacy], posted.ledger, reversalId, undefined, context(3));
    freezeRecursively(reversal.originalTransaction);
    const approvedReversal = transitionJournalTransaction(reversal.transaction, "approved", undefined, context(4));
    const postedReversal = postJournalTransaction(approvedReversal, reversal.ledger, undefined, context(5));
    const reversedOriginal = markJournalTransactionReversed(reversal.originalTransaction, postedReversal.ledger, undefined, context(5));

    expect(legacy).not.toHaveProperty("auditEvents");
    expect(legacy.status).toBe("posted");
    expect(types(reversal.originalTransaction)).toEqual(["transaction_reversal_created"]);
    expect(types(reversedOriginal)).toEqual([
      "transaction_reversal_created", "transaction_reversal_posted", "transaction_marked_reversed",
    ]);
    expect(types(postedReversal.transaction)).toEqual(["transaction_created", "transaction_approved", "transaction_posted"]);
    expect(events(reversedOriginal)[0]).toBe(events(reversal.originalTransaction)[0]);
    expect(reversedOriginal.suggestion).toBe(legacy.suggestion);
    expectFrozenRecursively(reversedOriginal.auditEvents);
    expectFrozenRecursively(postedReversal.transaction.auditEvents);
  });
});

describe("rejected operations do not record successful audit actions", () => {
  it("rejects invalid approval and invalid transitions without changing existing history", () => {
    const original = reviewed();
    const before = events(original);
    const invalid: JournalTransaction = { ...original, suggestion: {
      ...original.suggestion, entry: { ...original.suggestion.entry, lines: [] },
    } };

    expect(() => transitionJournalTransaction(invalid, "approved", undefined, context(1))).toThrow();
    expect(() => transitionJournalTransaction(original, "posted", undefined, context(1))).toThrow();
    expect(events(original)).toBe(before);
    expect(events(invalid)).toBe(before);
    expect(types(original)).toEqual(["transaction_created", "transaction_submitted_for_approval"]);
  });

  it("does not create another approval event from repeated or missing-ID chat approvals", () => {
    const state = createChatState([messageFor(reviewed())]);
    const approvedState = approveInChat(state, originalId);
    const approvedTransaction = findTransaction(approvedState, originalId);
    const repeated = approveChatTransaction(approvedState.messages, originalId, context(2));
    const missing = approveChatTransaction(approvedState.messages, "missing", context(2));

    expect(repeated).toEqual(approvedState.messages);
    expect(missing).toEqual(approvedState.messages);
    expect(repeated[0]).toBe(approvedState.messages[0]);
    expect(types(approvedTransaction)).toEqual(["transaction_created", "transaction_submitted_for_approval", "transaction_approved"]);
  });

  it.each(["awaiting_approval", "approved"] as const)("does not record success after a rejected %s edit", (status) => {
    const original = status === "approved" ? approved() : reviewed();
    const state = createChatState([messageFor(original)]);
    const invalid = { ...edit(original.suggestion.entry), lines: [] };
    const rejected = editChatTransaction(state, originalId, invalid, context(3));

    expect(rejected.editingError).toEqual({ transactionId: originalId, message: expect.any(String) });
    expect(rejected.messages).toBe(state.messages);
    expect(rejected.ledger).toBe(state.ledger);
    expect(events(findTransaction(rejected, originalId))).toBe(events(original));
    expect(types(original)).not.toContain("transaction_edited");
  });

  it("keeps posted entries non-editable without adding an audit event", () => {
    const state = postedChatState();
    const original = findTransaction(state, originalId);
    const rejected = editChatTransaction(state, originalId, edit(original.suggestion.entry), context(3));

    expect(rejected.editingError?.message).toEqual(expect.any(String));
    expect(rejected.messages).toBe(state.messages);
    expect(rejected.ledger).toBe(state.ledger);
    expect(events(findTransaction(rejected, originalId))).toBe(events(original));
    expect(types(original)).toEqual(["transaction_created", "transaction_submitted_for_approval", "transaction_approved", "transaction_posted"]);
  });

  it("rejects premature, invalid, duplicate, and stale posts without a successful event", () => {
    const proposed = reviewed();
    const prematureState = createChatState([messageFor(proposed)]);
    const premature = postChatTransaction(prematureState, originalId, context(2));
    const approvedState = approveInChat(prematureState, originalId);
    const approvedTransaction = findTransaction(approvedState, originalId);
    const invalidState: ChatState = { ...approvedState, messages: [messageFor({
      ...approvedTransaction, suggestion: { ...approvedTransaction.suggestion, entry: { ...approvedTransaction.suggestion.entry, lines: [] } },
    })] };
    const invalid = postChatTransaction(invalidState, originalId, context(2));
    const posted = postChatTransaction(approvedState, originalId, context(2));
    const duplicate = postChatTransaction(posted, originalId, context(3));
    const staleState = { ...posted, messages: approvedState.messages };
    const stale = postChatTransaction(staleState, originalId, context(3));

    for (const [source, rejected] of [[prematureState, premature], [invalidState, invalid], [posted, duplicate], [staleState, stale]] as const) {
      expect(rejected.postingError).toEqual(expect.any(String));
      expect(rejected.messages).toBe(source.messages);
      expect(rejected.ledger).toBe(source.ledger);
      expect(events(findTransaction(rejected, originalId))).toBe(events(findTransaction(source, originalId)));
    }
    expect(types(findTransaction(posted, originalId)).filter((type) => type === "transaction_posted")).toHaveLength(1);
    expect(types(approvedTransaction)).not.toContain("transaction_posted");
  });

  it("rejects invalid and duplicate reversal creation without another creation event", () => {
    const unposted = createChatState([messageFor(reviewed())]);
    const rejectedUnposted = reverseChatTransaction(unposted, originalId, reversalId, context(3));
    const original = postedChatState();
    const missing = reverseChatTransaction(original, "missing", reversalId, context(3));
    const pending = reverseChatTransaction(original, originalId, reversalId, context(3));
    const repeated = reverseChatTransaction(pending, originalId, "audit-repeated-reversal", context(4));
    const staleState = { ...pending, messages: original.messages };
    const stale = reverseChatTransaction(staleState, originalId, "audit-stale-reversal", context(4));

    for (const [source, rejected] of [[unposted, rejectedUnposted], [original, missing], [pending, repeated], [staleState, stale]] as const) {
      expect(rejected.reversalError).toEqual(expect.any(String));
      expect(rejected.messages).toBe(source.messages);
      expect(rejected.ledger).toBe(source.ledger);
      expect(transactions(rejected).map(events)).toEqual(transactions(source).map(events));
    }
    expect(transactions(pending).flatMap(events).filter(({ type }) => type === "transaction_reversal_created")).toHaveLength(1);
    expect(events(findTransaction(pending, originalId)).filter(({ type }) => type === "transaction_reversal_created")).toHaveLength(1);
    expect(types(findTransaction(pending, reversalId))).toEqual(["transaction_created"]);
  });

  it("keeps completed own histories unchanged after repeated and stale reversal or posting actions", () => {
    const original = postedChatState();
    const pending = reverseChatTransaction(original, originalId, reversalId, context(3));
    const approvedState = approveInChat(pending, reversalId, 4);
    const completed = postChatTransaction(approvedState, reversalId, context(5));
    const histories = transactions(completed).map(events);
    const repeatedApproval = approveChatTransaction(completed.messages, reversalId, context(6));
    const repeatedPost = postChatTransaction(completed, reversalId, context(6));
    const repeatedReverse = reverseChatTransaction(completed, originalId, "audit-completed-repeat", context(6));
    const stalePostingState = { ...completed, messages: approvedState.messages };
    const stalePost = postChatTransaction(stalePostingState, reversalId, context(6));
    const staleReversalState = { ...completed, messages: original.messages };
    const staleReverse = reverseChatTransaction(staleReversalState, originalId, "audit-completed-stale", context(6));

    expect(completed.postingError).toBeUndefined();
    expect(repeatedApproval).toEqual(completed.messages);
    expect(repeatedPost.postingError).toEqual(expect.any(String));
    expect(repeatedReverse.reversalError).toEqual(expect.any(String));
    expect(stalePost.postingError).toEqual(expect.any(String));
    expect(staleReverse.reversalError).toEqual(expect.any(String));
    for (const [source, rejected] of [
      [completed, repeatedPost], [completed, repeatedReverse],
      [stalePostingState, stalePost], [staleReversalState, staleReverse],
    ] as const) {
      expect(rejected.messages).toBe(source.messages);
      expect(rejected.ledger).toBe(source.ledger);
      expect(transactions(rejected).map(events)).toEqual(transactions(source).map(events));
    }
    expect(transactions(completed).map(events)).toEqual(histories);
    expect(types(findTransaction(completed, originalId))).toEqual([
      "transaction_created", "transaction_submitted_for_approval", "transaction_approved", "transaction_posted",
      "transaction_reversal_created", "transaction_reversal_posted", "transaction_marked_reversed",
    ]);
    expect(types(findTransaction(completed, reversalId))).toEqual([
      "transaction_created", "transaction_approved", "transaction_posted",
    ]);
    expect(completed.ledger.journalEntries).toHaveLength(2);
  });

  it("does not record reversal-posted or original-reversed when an edited inverse fails posting", () => {
    const original = postedChatState();
    const pending = reverseChatTransaction(original, originalId, reversalId, context(3));
    const reverse = findTransaction(pending, reversalId);
    const changed = editChatTransaction(pending, reversalId, { ...reverse.suggestion.entry, lines: [
      { accountId: "rent-expense", debit: 0, credit: 701.125 },
      { accountId: "bank", debit: 701.125, credit: 0 },
    ] }, context(4));
    const approvedState = approveInChat(changed, reversalId, 5);
    const rejected = postChatTransaction(approvedState, reversalId, context(6));

    expect(changed.editingError).toBeUndefined();
    expect(rejected.postingError).toEqual(expect.any(String));
    expect(rejected.messages).toBe(approvedState.messages);
    expect(rejected.ledger).toBe(approvedState.ledger);
    expect(types(findTransaction(rejected, reversalId))).not.toContain("transaction_reversal_posted");
    expect(types(findTransaction(rejected, originalId))).not.toContain("transaction_reversal_posted");
    expect(types(findTransaction(rejected, originalId))).not.toContain("transaction_marked_reversed");
    expect(findTransaction(rejected, originalId).status).toBe("posted");
  });

  it("discards candidate posting events when subsequently marking the original reversed fails", () => {
    const original = postedChatState();
    const pending = reverseChatTransaction(original, originalId, reversalId, context(3));
    const approvedState = approveInChat(pending, reversalId, 4);
    const staleOriginalState: ChatState = { ...approvedState, messages: approvedState.messages.map((message) =>
      message.sender === "ai" && message.transaction?.suggestion.entry.id === originalId
        ? { ...message, transaction: { ...message.transaction, status: "approved" } }
        : message) };
    const beforeHistories = transactions(staleOriginalState).map(events);
    const rejected = postChatTransaction(staleOriginalState, reversalId, context(5));

    expect(rejected.postingError).toEqual(expect.any(String));
    expect(rejected.messages).toBe(staleOriginalState.messages);
    expect(rejected.ledger).toBe(staleOriginalState.ledger);
    expect(transactions(rejected).map(events)).toEqual(beforeHistories);
    expect(types(findTransaction(rejected, reversalId))).not.toContain("transaction_posted");
    expect(types(findTransaction(rejected, reversalId))).not.toContain("transaction_reversal_posted");
    expect(types(findTransaction(rejected, originalId))).not.toContain("transaction_reversal_posted");
    expect(types(findTransaction(rejected, originalId))).not.toContain("transaction_marked_reversed");
    expect(rejected.ledger.journalEntries).toHaveLength(1);
  });

  it("cannot mark the original reversed before posting and rejects repeated marking", () => {
    const pending = pendingReversal();
    const history = events(pending.reversal.originalTransaction);
    expect(() => markJournalTransactionReversed(pending.reversal.originalTransaction, pending.reversal.ledger, undefined, context(4))).toThrow();
    expect(events(pending.reversal.originalTransaction)).toBe(history);
    const completed = completedReversal();
    const completedHistory = events(completed.original);
    expect(() => markJournalTransactionReversed(completed.original, completed.posted.ledger, undefined, context(6))).toThrow();
    expect(events(completed.original)).toBe(completedHistory);
    expect(types(completed.original).filter((type) => type === "transaction_marked_reversed")).toHaveLength(1);
  });

  it("does not log approval when supplied account references fail Accounting Core validation", () => {
    const original = reviewed();
    const chartWithoutBank = DEFAULT_CHART_OF_ACCOUNTS.filter(({ id }) => id !== "bank");

    expect(() => transitionJournalTransaction(original, "approved", chartWithoutBank, context(1))).toThrow();
    expect(types(original)).toEqual(["transaction_created", "transaction_submitted_for_approval"]);
  });
});

describe("audit history preserves existing accounting and session behavior", () => {
  it("uses one action timestamp for both reversal posting and marking the original reversed in chat", () => {
    const original = postedChatState();
    const pending = reverseChatTransaction(original, originalId, reversalId, context(3));
    const beforeOriginal = findTransaction(pending, originalId);
    const originalEntry = beforeOriginal.suggestion.entry;
    const approvedState = approveInChat(pending, reversalId, 4);
    const posted = postChatTransaction(approvedState, reversalId, context(5));

    expect(posted.postingError).toBeUndefined();
    expect(findTransaction(posted, originalId).status).toBe("reversed");
    expect(findTransaction(posted, reversalId).status).toBe("posted");
    expect(events(findTransaction(posted, originalId)).at(-2)?.timestamp).toBe(context(5).timestamp);
    expect(events(findTransaction(posted, originalId)).at(-1)?.timestamp).toBe(context(5).timestamp);
    expect(events(findTransaction(posted, reversalId)).at(-1)?.timestamp).toBe(context(5).timestamp);
    expect(findTransaction(posted, originalId).suggestion.entry).toBe(originalEntry);
    expect(posted.ledger.journalEntries[0]).toBe(originalEntry);
    expect(beforeOriginal.status).toBe("posted");
  });

  it("viewing audit history never changes ledger entries, balances, trial balance, or statements", () => {
    const completed = completedReversal();
    const ledger = completed.posted.ledger;
    const before = structuredClone(ledger);
    const allTransactions = [completed.original, completed.posted.transaction];
    freezeRecursively(ledger);

    for (let index = 0; index < 3; index += 1) {
      expect(getTransactionAuditEvents(originalId, allTransactions)).toHaveLength(7);
      expect(getTransactionAuditEvents(reversalId, allTransactions)).toHaveLength(3);
    }

    expect(ledger).toEqual(before);
    expect(ledger.balances.every(({ balance }) => balance === 0)).toBe(true);
    expect(ledger.trialBalance).toMatchObject({ totalDebits: 0, totalCredits: 0, balanced: true });
    expect(ledger.profitAndLoss.netIncome).toBe(0);
    expect(ledger.balanceSheet).toEqual(before.balanceSheet);
  });

  it("keeps audited actions entirely in memory without storage writes, requests, or dataset changes", () => {
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
    let state = createChatState([messageFor(reviewed())]);
    state = editChatTransaction(state, originalId, edit(findTransaction(state, originalId).suggestion.entry), context(1));
    state = postChatTransaction(approveInChat(state, originalId, 2), originalId, context(3));
    state = reverseChatTransaction(state, originalId, reversalId, context(4));
    state = postChatTransaction(approveInChat(state, reversalId, 5), reversalId, context(6));
    const history = getTransactionAuditEvents(originalId, transactions(state));

    expect(history.map(({ type }) => type)).toContain("transaction_edited");
    expect(findTransaction(state, originalId).status).toBe("reversed");
    expect(immutableDataset).toEqual(before);
    expect(saveDataset).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
    expect(createChatState([]).messages).toEqual([]);
    expect(createChatState([]).ledger.journalEntries).toEqual([]);
    expect(getTransactionAuditEvents(originalId, [])).toEqual([]);
  });

  it.each([
    ["What is my profit?", "67,130 KWD"],
    ["What are total expenses?", "27,870 KWD"],
    ["What is my highest expense?", "16,550 KWD"],
  ] as const)("preserves deterministic financial Q&A after audited editing, posting, and reversal: %s", async (question, amount) => {
    const analyst = vi.fn();
    const immutableDataset = structuredClone(dataset);
    freezeRecursively(immutableDataset);
    const before = await routeFinancialQuestion(question, immutableDataset, analyst);
    let state = createChatState([messageFor(reviewed())]);
    state = editChatTransaction(state, originalId, edit(findTransaction(state, originalId).suggestion.entry), context(1));
    state = postChatTransaction(approveInChat(state, originalId, 2), originalId, context(3));
    state = reverseChatTransaction(state, originalId, reversalId, context(4));
    state = postChatTransaction(approveInChat(state, reversalId, 5), reversalId, context(6));
    getTransactionAuditEvents(originalId, transactions(state));
    const after = await routeChatMessage(question, immutableDataset, analyst, { id: "audit-financial-answer", date: "2026-10-08" });

    expect(after).toEqual(before);
    expect(after).toMatchObject({ route: "local", text: expect.stringContaining(amount) });
    expect(analyst).not.toHaveBeenCalled();
    expect(state.ledger.balances.every(({ balance }) => balance === 0)).toBe(true);
  });
});
