import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatPage from "@/app/chat/page";
import ChatInput from "@/components/chat/ChatInput";
import ChatWindow from "@/components/chat/ChatWindow";
import TransactionAuditTrail from "@/components/chat/TransactionAuditTrail";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import { getTransactionAuditEvents } from "@/lib/accounting/audit-trail";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { createSuggestedTransaction } from "@/lib/accounting/transaction-workflow";
import {
  approveChatTransaction, createChatState, editChatTransaction, postChatTransaction,
  reverseChatTransaction, type ChatState,
} from "@/lib/chat";

type HookFrame = {
  values: unknown[];
  cursor: number;
  betweenReplays?: () => void;
  replayResults: { first: unknown; second: unknown }[];
};
const hooks = vi.hoisted(() => ({ active: null as HookFrame | null }));

// Replay each updater against the same state, as React can in development.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState(initial: unknown) {
      const frame = hooks.active;
      if (!frame) return actual.useState(initial);
      const index = frame.cursor++;
      if (!(index in frame.values)) frame.values[index] = typeof initial === "function" ? initial() : initial;
      return [frame.values[index], (next: unknown) => {
        if (typeof next !== "function") { frame.values[index] = next; return; }
        const previous = frame.values[index];
        const first = next(previous);
        frame.betweenReplays?.();
        const second = next(previous);
        frame.replayResults.push({ first, second });
        frame.values[index] = second;
      }];
    },
    useRef(initial: unknown) {
      const frame = hooks.active;
      if (!frame) return actual.useRef(initial);
      const index = frame.cursor++;
      if (!(index in frame.values)) frame.values[index] = { current: initial };
      return frame.values[index];
    },
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));
vi.mock("@/components/providers/LedgerProvider", () => ({ useLedgerData: vi.fn() }));

const originalId = "audit-ui-rent";
const reversalId = "audit-ui-reversal";
const context = (second: number) => ({ timestamp: `2026-10-08T09:00:${String(second).padStart(2, "0")}.000Z` });

afterEach(() => {
  hooks.active = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function reviewState(amount = 700.125): ChatState {
  const parsed = parseTransactionIntent(`paid rent ${amount} KWD from bank`);
  if (parsed.status !== "resolved") throw new Error("Expected a transaction.");
  const proposed = suggestJournalEntry(parsed.intent, { id: originalId, date: "2026-10-07" });
  if (proposed.status !== "suggested") throw new Error("Expected a suggestion.");
  return createChatState([{ sender: "ai", text: "Accounting suggestion", transaction: createSuggestedTransaction(proposed.suggestion, context(0)) }]);
}

function approve(state: ChatState, id = originalId, second = 1) {
  return { ...state, messages: approveChatTransaction(state.messages, id, context(second)) };
}

function postedState() {
  return postChatTransaction(approve(reviewState()), originalId, context(2));
}

function transactionAt(state: ChatState, index: number) {
  const message = state.messages[index];
  if (message.sender !== "ai" || !message.transaction) throw new Error("Expected a transaction.");
  return message.transaction;
}

function trail(state: ChatState, id = originalId): string {
  const transactions = state.messages.flatMap((message) => message.sender === "ai" && message.transaction ? [message.transaction] : []);
  return renderToStaticMarkup(createElement(TransactionAuditTrail, { events: getTransactionAuditEvents(id, transactions) }));
}

type NodeProps = { children?: ReactNode };
function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<NodeProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function pageHarness(initial: ChatState) {
  vi.mocked(useLedgerData).mockReturnValue({
    dataset: null, isReady: true, insights: [], alerts: [],
    uploadFeedback: { status: "idle", message: "", warnings: [], errors: [] }, uploadFile: vi.fn(),
  });
  const frame: HookFrame = {
    values: [false, { current: 0 }, initial], cursor: 0, replayResults: [],
    betweenReplays: () => vi.setSystemTime(new Date(Date.now() + 1_000)),
  };
  function render() {
    frame.cursor = 0;
    hooks.active = frame;
    try { return ChatPage(); } finally { hooks.active = null; }
  }
  function windowProps() {
    const window = elements(render()).find((element) => element.type === ChatWindow);
    if (!window) throw new Error("Expected ChatWindow.");
    return (window as ReactElement<ComponentProps<typeof ChatWindow>>).props;
  }
  return { frame, render, windowProps, get state() { return frame.values[2] as ChatState; } };
}

describe("transaction audit trail display", () => {
  it("shows a collapsible creation history with the action time and initial workflow status", () => {
    const state = reviewState();
    const html = renderToStaticMarkup(createElement(ChatWindow, { messages: state.messages }));

    expect(html).toContain("<details");
    expect(html).toContain(">Audit trail</summary>");
    expect(html).toContain("Transaction created");
    expect(html.match(/>Submitted for approval<\/p>/g)).toHaveLength(1);
    expect(html).toMatch(/<time datetime="2026-10-08T09:00:00\.000Z"/i);
    expect(html).toContain("Status: draft");
    expect(html).toContain("Status: draft → awaiting approval");
    expect(html).toContain("Transaction: audit-ui-rent");
    expect(html).not.toContain("expense_payment");
    expect(html).not.toContain(":audit:");
    expect(html).not.toContain("validationErrors");
  });

  it("displays approval and posting transitions while retaining the original creation event", () => {
    const html = trail(postedState());
    expect(html).toContain("Transaction created");
    expect(html.match(/>Submitted for approval<\/p>/g)).toHaveLength(1);
    expect(html).toContain("Transaction approved");
    expect(html).toContain("Status: awaiting approval → approved");
    expect(html).toContain("Transaction posted");
    expect(html).toContain("Status: approved → posted");
    expect(html.indexOf("Transaction created")).toBeLessThan(html.indexOf("Transaction approved"));
    expect(html.indexOf("Transaction created")).toBeLessThan(html.indexOf("Submitted for approval"));
    expect(html.indexOf("Submitted for approval")).toBeLessThan(html.indexOf("Transaction approved"));
    expect(html.indexOf("Transaction approved")).toBeLessThan(html.indexOf("Transaction posted"));
  });

  it("shows public before/after entry details and approval reset for a successful edit", () => {
    const state = approve(reviewState());
    const entry = transactionAt(state, 0).suggestion.entry;
    const edited = editChatTransaction(state, originalId, { ...entry,
      date: "2026-10-08", description: "Corrected cash rent", currency: "USD",
      lines: [{ accountId: "rent-expense", debit: 800.125, credit: 0 }, { accountId: "cash", debit: 0, credit: 800.125 }],
    }, context(2));
    const html = trail(edited);

    expect(edited.editingError).toBeUndefined();
    expect(html).toContain("Transaction edited");
    expect(html).toContain("Status: approved → awaiting approval");
    expect(html).toContain("Journal entry changes");
    expect(html).toContain(">Before</p>");
    expect(html).toContain(">After</p>");
    expect(html).toContain("Credit Bank: 700.125 KWD");
    expect(html).toContain("Credit Cash: 800.125 USD");
    expect(html).toContain("Corrected cash rent");
    expect(html).not.toContain("expense_payment");
  });

  it("shows both frozen edit snapshots as labelled panels without a second closed disclosure", () => {
    const state = approve(reviewState(600));
    const entry = transactionAt(state, 0).suggestion.entry;
    const edited = editChatTransaction(state, originalId, { ...entry, lines: [
      { accountId: "rent-expense", debit: 700, credit: 0 },
      { accountId: "bank", debit: 0, credit: 700 },
    ] }, context(2));
    const events = getTransactionAuditEvents(originalId, [transactionAt(edited, 0)]);
    const event = events.find(({ type }) => type === "transaction_edited");
    if (!event || event.type !== "transaction_edited") throw new Error("Expected edit snapshots.");
    const snapshot = structuredClone(event.metadata);
    const view = TransactionAuditTrail({ events });
    const html = renderToStaticMarkup(view);
    const beforePanel = html.match(/<section aria-label="Before journal entry"[^>]*>(.*?)<\/section>/)?.[1];
    const afterPanel = html.match(/<section aria-label="After journal entry"[^>]*>(.*?)<\/section>/)?.[1];

    // Opening the outer audit trail exposes the panels; no nested details can hide them.
    expect(elements(view).filter((element) => element.type === "details")).toHaveLength(1);
    expect(beforePanel).toContain("Debit Rent Expense: 600 KWD");
    expect(beforePanel).toContain("Credit Bank: 600 KWD");
    expect(beforePanel).not.toContain("Debit Rent Expense: 700 KWD");
    expect(beforePanel).not.toContain("Credit Bank: 700 KWD");
    expect(afterPanel).toContain("Debit Rent Expense: 700 KWD");
    expect(afterPanel).toContain("Credit Bank: 700 KWD");
    expect(afterPanel).not.toContain("Debit Rent Expense: 600 KWD");
    expect(afterPanel).not.toContain("Credit Bank: 600 KWD");
    expect(event.metadata).toEqual(snapshot);
    expect(Object.isFrozen(event.metadata.before)).toBe(true);
    expect(Object.isFrozen(event.metadata.before.lines)).toBe(true);
    expect(Object.isFrozen(event.metadata.after)).toBe(true);
    expect(Object.isFrozen(event.metadata.after.lines)).toBe(true);
    expect(html.match(/>Submitted for approval<\/p>/g)).toHaveLength(1);
  });

  it("shows no success event for a rejected edit or premature post", () => {
    const state = reviewState();
    const rejectedEdit = editChatTransaction(state, originalId, { ...transactionAt(state, 0).suggestion.entry, lines: [] }, context(1));
    const rejectedPost = postChatTransaction(state, originalId, context(2));
    expect(trail(rejectedEdit)).toBe(trail(state));
    expect(trail(rejectedPost)).toBe(trail(state));
    expect(trail(rejectedEdit)).not.toContain("Transaction edited");
    expect(trail(rejectedPost)).not.toContain("Transaction posted");
  });

  it("shows specialized reversal actions only on the original and the reversal's own lifecycle without changing the ledger", () => {
    const original = postedState();
    const pending = reverseChatTransaction(original, originalId, reversalId, context(3));
    const originalPending = trail(pending);
    expect(originalPending).toContain("Reversal created");
    expect(originalPending).toContain("Related transaction: audit-ui-reversal");
    expect(originalPending).toContain("Transaction: audit-ui-rent");
    expect(originalPending).not.toContain("Transaction marked reversed");
    expect(trail(pending, reversalId)).toContain("Transaction created");
    expect(trail(pending, reversalId)).not.toContain("Reversal created");
    expect(pending.ledger.balances).toBe(original.ledger.balances);

    const completed = postChatTransaction(approve(pending, reversalId, 4), reversalId, context(5));
    const ledgerBefore = structuredClone(completed.ledger);
    const originalEvents = getTransactionAuditEvents(originalId, [transactionAt(completed, 0), transactionAt(completed, 1)]);
    const reversalEvents = getTransactionAuditEvents(reversalId, [transactionAt(completed, 0), transactionAt(completed, 1)]);
    expect(originalEvents.map(({ type }) => type)).toEqual([
      "transaction_created", "transaction_submitted_for_approval", "transaction_approved", "transaction_posted",
      "transaction_reversal_created", "transaction_reversal_posted", "transaction_marked_reversed",
    ]);
    expect(reversalEvents.map(({ type }) => type)).toEqual([
      "transaction_created", "transaction_approved", "transaction_posted",
    ]);
    const originalHtml = trail(completed);
    for (const action of ["Reversal created", "Reversal posted", "Transaction marked reversed"]) {
      expect(originalHtml.split(`>${action}</p>`)).toHaveLength(2);
    }
    expect(originalHtml).toContain("Status: posted → reversed");
    expect(originalHtml).toContain("Related transaction: audit-ui-reversal");
    expect(originalHtml).not.toContain("Related transaction: audit-ui-rent");
    expect(originalHtml.indexOf("Reversal posted")).toBeLessThan(originalHtml.indexOf("Transaction marked reversed"));
    expect(originalEvents.slice(-3).map(({ timestamp }) => timestamp)).toEqual([
      context(3).timestamp, context(5).timestamp, context(5).timestamp,
    ]);
    const reversalHtml = trail(completed, reversalId);
    for (const action of ["Transaction created", "Transaction approved", "Transaction posted"]) {
      expect(reversalHtml.split(`>${action}</p>`)).toHaveLength(2);
    }
    for (const action of ["Reversal created", "Reversal posted", "Transaction marked reversed", "Submitted for approval"]) {
      expect(reversalHtml).not.toContain(action);
    }
    expect(reversalHtml).toContain("Related transaction: audit-ui-rent");
    expect(reversalHtml).not.toContain("Status: posted → reversed");
    const view = ChatWindow({ messages: completed.messages });
    expect(elements(view).filter((element) => element.type === TransactionAuditTrail)).toHaveLength(2);
    expect(completed.ledger).toEqual(ledgerBefore);
    expect(completed.ledger.balances.every(({ balance }) => balance === 0)).toBe(true);
  });

  it("does not show a completed reversal when posting is rejected", () => {
    const pending = reverseChatTransaction(postedState(), originalId, reversalId, context(3));
    const rejected = postChatTransaction(pending, reversalId, context(4));
    expect(trail(rejected, reversalId)).not.toContain("Transaction posted");
    expect(trail(rejected, reversalId)).not.toContain("Reversal posted");
    expect(trail(rejected)).not.toContain("Transaction marked reversed");
  });

  it("does not add audit UI to ordinary financial messages or transactions without a recorded history", () => {
    const state = reviewState();
    const transaction = transactionAt(state, 0);
    const html = renderToStaticMarkup(createElement(ChatWindow, { messages: [
      { sender: "ai", text: "67,130 KWD" },
      { sender: "ai", text: "Existing entry", transaction: { status: transaction.status, suggestion: transaction.suggestion } },
    ] }));
    expect(html).not.toContain("Audit trail");
    expect(html).toContain("67,130 KWD");
  });

  it("captures page action timestamps before state-updater replay for approval, edit, posting, and reversal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(context(1).timestamp);
    const page = pageHarness(reviewState());
    page.windowProps().onApprove?.(originalId);
    expect(transactionAt(page.state, 0).auditEvents?.at(-1)?.timestamp).toBe(context(1).timestamp);
    expect(page.frame.replayResults.at(-1)?.first).toEqual(page.frame.replayResults.at(-1)?.second);

    vi.setSystemTime(context(3).timestamp);
    const entry = transactionAt(page.state, 0).suggestion.entry;
    page.windowProps().onEdit?.(originalId, { ...entry, description: "Edited rent" });
    expect(transactionAt(page.state, 0).auditEvents?.at(-1)?.timestamp).toBe(context(3).timestamp);
    expect(transactionAt(page.state, 0).status).toBe("awaiting_approval");

    vi.setSystemTime(context(5).timestamp);
    page.windowProps().onApprove?.(originalId);
    vi.setSystemTime(context(7).timestamp);
    page.windowProps().onPost?.(originalId);
    expect(transactionAt(page.state, 0).auditEvents?.at(-1)?.timestamp).toBe(context(7).timestamp);

    vi.setSystemTime(context(9).timestamp);
    page.windowProps().onReverse?.(originalId);
    const reversed = transactionAt(page.state, 1);
    expect(reversed.auditEvents?.map(({ timestamp }) => timestamp)).toEqual([context(9).timestamp]);
    expect(transactionAt(page.state, 0).auditEvents?.at(-1)).toMatchObject({
      type: "transaction_reversal_created", timestamp: context(9).timestamp,
    });
    const id = reversed.suggestion.entry.id;
    vi.setSystemTime(context(11).timestamp);
    page.windowProps().onApprove?.(id);
    vi.setSystemTime(context(13).timestamp);
    page.windowProps().onPost?.(id);
    expect(transactionAt(page.state, 0).auditEvents?.at(-1)?.timestamp).toBe(context(13).timestamp);
    expect(transactionAt(page.state, 1).auditEvents?.at(-1)?.timestamp).toBe(context(13).timestamp);
    expect(transactionAt(page.state, 1).auditEvents?.map(({ type }) => type)).toEqual([
      "transaction_created", "transaction_approved", "transaction_posted",
    ]);
    for (const replay of page.frame.replayResults) expect(replay.first).toEqual(replay.second);
    expect(page.state.ledger.balances.every(({ balance }) => balance === 0)).toBe(true);
  });

  it("creates the suggestion once before its message updater is replayed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(context(0).timestamp);
    const page = pageHarness(createChatState([]));
    const input = elements(page.render()).find((element) => element.type === ChatInput);
    if (!input) throw new Error("Expected ChatInput.");
    const props = (input as ReactElement<ComponentProps<typeof ChatInput>>).props;
    await props.onSend("paid rent 700.125 KWD from bank");
    const messages = page.state.messages.filter((message) => message.sender === "ai" && message.transaction);
    expect(messages).toHaveLength(1);
    const transaction = messages[0].sender === "ai" ? messages[0].transaction : undefined;
    expect(transaction?.auditEvents?.map(({ type }) => type)).toEqual([
      "transaction_created", "transaction_submitted_for_approval",
    ]);
    const html = renderToStaticMarkup(createElement(ChatWindow, page.windowProps()));
    expect(html.match(/>Submitted for approval<\/p>/g)).toHaveLength(1);
    for (const replay of page.frame.replayResults) expect(replay.first).toEqual(replay.second);
  });
});
