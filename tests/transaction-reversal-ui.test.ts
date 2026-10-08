import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatPage from "@/app/chat/page";
import ChatWindow from "@/components/chat/ChatWindow";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import type { JournalEntry } from "@/lib/accounting/types";
import { approveChatTransaction, createChatState, editChatTransaction, postChatTransaction, reverseChatTransaction, type ChatState } from "@/lib/chat";

type HookFrame = { values: unknown[]; cursor: number };
const hooks = vi.hoisted(() => ({ active: null as HookFrame | null }));

// Direct page renders exercise its real functional state updates; SSR uses React hooks.
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
        frame.values[index] = typeof next === "function" ? next(frame.values[index]) : next;
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

afterEach(() => {
  hooks.active = null;
  vi.restoreAllMocks();
});

const originalId = "ui-posted-rent";
const reversalId = "ui-reversal-1";
type NodeProps = { children?: ReactNode; onClick?: () => void };

function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<NodeProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function action(node: ReactNode, label: string): () => void {
  const callback = elements(node).find((element) => element.type === "button" && element.props.children === label)?.props.onClick;
  if (!callback) throw new Error(`Expected ${label} action.`);
  return callback;
}

function stateFor(status: JournalTransactionStatus = "awaiting_approval"): ChatState {
  const parsed = parseTransactionIntent("paid rent 700.125 KWD from bank");
  if (parsed.status !== "resolved") throw new Error("Expected a resolved transaction.");
  const result = suggestJournalEntry(parsed.intent, { id: originalId, date: "2026-10-08" });
  if (result.status !== "suggested") throw new Error("Expected a validated suggestion.");
  return createChatState([{ sender: "ai", text: "Accounting suggestion", transaction: {
    ...createSuggestedTransaction(result.suggestion), status,
  } }]);
}

function postedState(): ChatState {
  const state = stateFor();
  return postChatTransaction({ ...state, messages: approveChatTransaction(state.messages, originalId) }, originalId);
}

function transactionAt(state: ChatState, index: number) {
  const message = state.messages[index];
  if (message?.sender !== "ai" || !message.transaction) throw new Error("Expected an accounting transaction.");
  return message.transaction;
}

function chatHarness(initialState = postedState()) {
  let state = initialState;
  const onReverse = vi.fn((id: string) => { state = reverseChatTransaction(state, id, reversalId); });
  const onApprove = vi.fn((id: string) => { state = { ...state, messages: approveChatTransaction(state.messages, id) }; });
  const onPost = vi.fn((id: string) => { state = postChatTransaction(state, id); });
  const onEdit = vi.fn((id: string, entry: JournalEntry) => {
    state = editChatTransaction(state, id, entry);
  });
  function render() {
    return ChatWindow({ messages: state.messages, onReverse, onApprove, onPost, onEdit });
  }
  return { render, onReverse, onApprove, onPost, get state() { return state; } };
}

describe("posted journal reversal UI", () => {
  it.each(["draft", "awaiting_approval", "approved"] as const)("hides Reverse for %s and preserves the existing Edit rules", (status) => {
    const state = stateFor(status);
    const html = renderToStaticMarkup(createElement(ChatWindow, {
      messages: state.messages, onReverse: vi.fn(), onApprove: vi.fn(), onPost: vi.fn(), onEdit: vi.fn(),
    }));

    expect(html).not.toContain(">Reverse</button>");
    expect(html.includes(">Edit</button>")).toBe(status === "awaiting_approval" || status === "approved");
    expect(html.includes(">Approve</button>")).toBe(status === "awaiting_approval");
    expect(html.includes(">Post</button>")).toBe(status === "approved");
  });

  it("offers Reverse on an original posted entry while leaving it non-editable", () => {
    const ui = chatHarness();
    const html = renderToStaticMarkup(ui.render());

    expect(html).toContain(">Posted</p>");
    expect(html).toContain(">Reverse</button>");
    expect(html).not.toContain(">Edit</button>");
    expect(html).not.toContain(">Approve</button>");
    expect(html).not.toContain(">Post</button>");
    expect(ui.onReverse).not.toHaveBeenCalled();
    expect(ui.state.messages).toHaveLength(1);
  });

  it("requires separate Reverse, Approve, and Post actions and shows both transactions", () => {
    const ui = chatHarness();
    const original = transactionAt(ui.state, 0);
    const originalEntry = original.suggestion.entry;
    const originalSnapshot = structuredClone(original);
    const ledger = ui.state.ledger;

    action(ui.render(), "Reverse")();

    expect(ui.onReverse).toHaveBeenCalledWith(originalId);
    expect(transactionAt(ui.state, 0)).toEqual(originalSnapshot);
    expect(transactionAt(ui.state, 1)).toMatchObject({
      status: "awaiting_approval", reversalOfTransactionId: originalId,
      suggestion: { entry: { id: reversalId, date: originalEntry.date, currency: "KWD", lines: [
        { accountId: "rent-expense", debit: 0, credit: 700.125 },
        { accountId: "bank", debit: 700.125, credit: 0 },
      ] } },
    });
    expect(ui.state.ledger.journalEntries).toBe(ledger.journalEntries);
    expect(ui.state.ledger.balances).toEqual(ledger.balances);
    expect(ui.onApprove).not.toHaveBeenCalled();
    expect(ui.onPost).not.toHaveBeenCalled();
    const review = renderToStaticMarkup(ui.render());
    expect(review).toContain("Transaction ID: ui-reversal-1");
    expect(review).toContain("Reversal of transaction: ui-posted-rent");
    expect(review).toContain("Reversing Journal Entry");
    expect(review).toContain("Debit Bank: 700.125 KWD");
    expect(review).toContain("Credit Rent Expense: 700.125 KWD");
    expect(review).toContain(">Posted</p>");
    expect(review).toContain(">Awaiting approval</p>");
    expect(review).toContain("Reversal: ui-reversal-1 · Awaiting approval");
    expect(review).toContain(">Edit</button>");
    expect(review).not.toContain(">Reverse</button>");
    expect(review).not.toContain(">Post</button>");

    action(ui.render(), "Approve")();

    expect(ui.onApprove).toHaveBeenCalledWith(reversalId);
    expect(transactionAt(ui.state, 1).status).toBe("approved");
    expect(transactionAt(ui.state, 0).status).toBe("posted");
    expect(ui.state.ledger.journalEntries).toHaveLength(1);
    const approved = renderToStaticMarkup(ui.render());
    expect(approved).toContain("Reversal: ui-reversal-1 · Approved");
    expect(approved).toContain(">Edit</button>");
    expect(approved).toContain(">Post</button>");

    action(ui.render(), "Post")();

    expect(ui.onPost).toHaveBeenCalledWith(reversalId);
    expect(transactionAt(ui.state, 0)).toMatchObject({ status: "reversed", reversedByTransactionId: reversalId });
    expect(transactionAt(ui.state, 1).status).toBe("posted");
    expect(transactionAt(ui.state, 0).suggestion.entry).toBe(originalEntry);
    expect(original).toEqual(originalSnapshot);
    expect(ui.state.ledger.journalEntries).toHaveLength(2);
    expect(ui.state.ledger.journalEntries[0]).toBe(originalEntry);
    for (const account of ui.state.ledger.balances) expect(account.balance).toBe(0);
    const posted = renderToStaticMarkup(ui.render());
    expect(posted).toContain(">Reversed</p>");
    expect(posted).toContain("Reversed by transaction: ui-reversal-1");
    expect(posted).toContain(">Posted</p>");
    expect(posted).toContain("Original entry and posted reversal remain in the session ledger.");
    expect(posted).not.toContain("<button");
  });

  it("rejects a stale Reverse callback before and after posting without creating another entry", () => {
    const ui = chatHarness();
    const staleReverse = action(ui.render(), "Reverse");
    staleReverse();
    const pending = ui.state;
    staleReverse();

    expect(ui.state.reversalError).toEqual(expect.any(String));
    expect(ui.state.messages).toBe(pending.messages);
    expect(ui.state.ledger).toBe(pending.ledger);
    expect(ui.state.messages).toHaveLength(2);
    action(ui.render(), "Approve")();
    action(ui.render(), "Post")();
    const completed = ui.state;
    staleReverse();

    expect(ui.state.reversalError).toEqual(expect.any(String));
    expect(ui.state.messages).toBe(completed.messages);
    expect(ui.state.ledger).toBe(completed.ledger);
    expect(ui.state.ledger.journalEntries).toHaveLength(2);
  });

  it("leaves the original Posted when reversal posting fails", () => {
    const initial = postedState();
    const pending = reverseChatTransaction(initial, originalId, reversalId);
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, reversalId) };
    const invalid = {
      ...approved,
      messages: approved.messages.map((message) => message.sender === "ai" && message.transaction?.suggestion.entry.id === reversalId
        ? { ...message, transaction: { ...message.transaction, suggestion: {
          ...message.transaction.suggestion, entry: { ...message.transaction.suggestion.entry, lines: [] },
        } } } : message),
    };
    const rejected = postChatTransaction(invalid, reversalId);
    const html = renderToStaticMarkup(createElement(ChatWindow, { messages: rejected.messages, onReverse: vi.fn() }));

    expect(rejected.postingError).toEqual(expect.any(String));
    expect(rejected.ledger).toBe(approved.ledger);
    expect(transactionAt(rejected, 0)).toBe(transactionAt(initial, 0));
    expect(html).toContain(">Posted</p>");
    expect(html).not.toContain(">Reversed</p>");
    expect(html).not.toContain(">Reverse</button>");
  });

  it("wires the page's Reverse callback to current state, unique IDs, and a visible rejection alert", () => {
    vi.mocked(useLedgerData).mockReturnValue({
      dataset: null, isReady: true, insights: [], alerts: [],
      uploadFeedback: { status: "idle", message: "", warnings: [], errors: [] }, uploadFile: vi.fn(),
    });
    const frame: HookFrame = { values: [false, { current: 0 }, postedState()], cursor: 0 };
    function renderPage() {
      frame.cursor = 0;
      hooks.active = frame;
      try { return ChatPage(); } finally { hooks.active = null; }
    }
    const page = renderPage();
    const window = elements(page).find((element) => element.type === ChatWindow) as ReactElement<ComponentProps<typeof ChatWindow>> | undefined;
    if (!window?.props.onReverse) throw new Error("Expected a page reversal action.");
    const staleReverse = action(ChatWindow(window.props), "Reverse");
    staleReverse();
    const pending = frame.values[2] as ChatState;

    expect(transactionAt(pending, 1).suggestion.entry.id).toBe("chat-reversal-1");
    expect(transactionAt(pending, 0).status).toBe("posted");
    staleReverse();
    const rejected = frame.values[2] as ChatState;
    expect(rejected.messages).toBe(pending.messages);
    expect(rejected.ledger).toBe(pending.ledger);
    expect(rejected.reversalError).toEqual(expect.any(String));
    const html = renderToStaticMarkup(renderPage());
    expect(html).toContain('role="alert"');
    expect(html).toContain(rejected.reversalError);
    expect(html).not.toContain(">Reverse</button>");
  });
});
