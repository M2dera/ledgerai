import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountingSessionProvider, useAccountingSession } from "@/components/providers/AccountingSessionProvider";
import { createSuggestedTransaction } from "@/lib/accounting/transaction-workflow";
import { approveChatTransaction, postChatTransaction, routeChatMessage } from "@/lib/chat";

type Session = ReturnType<typeof useAccountingSession>;
type HookFrame = { values: unknown[]; cursor: number };
const hooks = vi.hoisted(() => ({ active: null as HookFrame | null, session: null as Session | null }));

// Keep the provider's hooks mounted while replacing its route child, without a DOM dependency.
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
    useContext(context: Parameters<typeof actual.useContext>[0]) {
      if (hooks.active && hooks.session) return hooks.session;
      return actual.useContext(context);
    },
  };
});

afterEach(() => { hooks.active = null; hooks.session = null; });

function ChatRoute() {
  const { chat } = useAccountingSession();
  return createElement("p", null, chat.messages.map(({ text }) => text).join(" "));
}

function LedgerRoute() {
  const { chat } = useAccountingSession();
  return createElement("p", null, `${chat.ledger.journalEntries.length} posted entries`);
}

function mountedSession() {
  const frame: HookFrame = { values: [], cursor: 0 };
  return {
    render(Route: () => ReactNode) {
      frame.cursor = 0;
      hooks.active = frame;
      try {
        const provider = AccountingSessionProvider({ children: createElement(Route) });
        const session = provider.props.value as Session;
        hooks.session = session;
        return { session, html: renderToStaticMarkup(Route()) };
      } finally { hooks.active = null; hooks.session = null; }
    },
  };
}

describe("shared accounting session", () => {
  it("starts with the existing workflow guidance, an empty ledger, and an explicit refresh boundary", () => {
    const mounted = mountedSession();
    const { session, html } = mounted.render(ChatRoute);
    expect(session.chat.messages).toHaveLength(1);
    expect(session.chat.ledger.journalEntries).toEqual([]);
    expect(html).toContain("Review or edit an unposted entry, approve it, then explicitly post it");
    expect(html).toContain("Editing an approved entry requires approval again");
    expect(html).toContain("Reverse creates a separate entry that also requires approval and posting");
    expect(html).toContain("Refreshing the page clears chat and the session ledger");
  });

  it("retains chat, the posted ledger, errors, and the ID sequence when route children change", async () => {
    const mounted = mountedSession();
    const first = mounted.render(ChatRoute).session;
    const id = first.nextTransactionId("suggestion");
    const result = await routeChatMessage("paid rent 700.125 KWD from bank", null, vi.fn(), { id, date: "2026-10-09" });
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected an accounting suggestion.");
    const audit = { timestamp: "2026-10-09T09:00:00.000Z" };
    const transaction = createSuggestedTransaction(result.suggestion, audit);
    first.setChat((current) => ({ ...current, messages: [...current.messages, { sender: "ai", text: result.text, transaction }] }));
    first.setChat((current) => ({ ...current, messages: approveChatTransaction(current.messages, id, audit) }));
    first.setChat((current) => postChatTransaction(current, id, audit));
    first.setChat((current) => ({ ...current, postingError: "Review the existing entry.", reversalError: "Reversal could not be created." }));
    const posted = mounted.render(ChatRoute).session.chat;

    const ledger = mounted.render(LedgerRoute);
    expect(ledger.html).toContain("1 posted entries");
    expect(ledger.session.chat).toBe(posted);
    expect(ledger.session.chat.ledger.journalEntries).toEqual([result.suggestion.entry]);
    expect(ledger.session.chat.postingError).toBe("Review the existing entry.");
    expect(ledger.session.chat.reversalError).toBe("Reversal could not be created.");
    const reversalId = ledger.session.nextTransactionId("reversal");

    const returned = mounted.render(ChatRoute);
    expect(returned.session.chat).toBe(posted);
    expect(returned.html).toContain(result.text);
    expect(returned.session.chat.messages.at(-1)).toMatchObject({ transaction: { status: "posted" } });
    expect([
      id, reversalId, returned.session.nextTransactionId("suggestion"), first.nextTransactionId("reversal"),
    ]).toEqual(["chat-suggestion-1", "chat-reversal-2", "chat-suggestion-3", "chat-reversal-4"]);
  });

  it("starts a fresh session and sequence when the provider is remounted", () => {
    const current = mountedSession().render(ChatRoute).session;
    current.nextTransactionId("suggestion");
    current.setChat((chat) => ({ ...chat, messages: [...chat.messages, { sender: "user", text: "Previous session" }] }));
    const refreshed = mountedSession().render(ChatRoute).session;
    expect(refreshed.chat.messages).toHaveLength(1);
    expect(refreshed.chat.ledger.journalEntries).toEqual([]);
    expect(refreshed.nextTransactionId("suggestion")).toBe("chat-suggestion-1");
  });

  it("requires the provider for consumers", () => {
    expect(() => renderToStaticMarkup(createElement(ChatRoute))).toThrow("useAccountingSession must be used within AccountingSessionProvider.");
  });
});
