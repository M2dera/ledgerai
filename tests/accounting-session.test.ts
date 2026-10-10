import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountingSessionProvider, useAccountingSession } from "@/components/providers/AccountingSessionProvider";
import { createSuggestedTransaction } from "@/lib/accounting/transaction-workflow";
import { approveChatTransaction, postChatTransaction, reverseChatTransaction, routeChatMessage } from "@/lib/chat";
import { getProfitLossReport, type ProfitLossFilters } from "@/lib/profit-loss";
import { getTrialBalanceReport } from "@/lib/trial-balance";

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

afterEach(() => { hooks.active = null; hooks.session = null; vi.unstubAllGlobals(); });

function ChatRoute() {
  const { chat } = useAccountingSession();
  return createElement("p", null, chat.messages.map(({ text }) => text).join(" "));
}

function LedgerRoute() {
  const { chat } = useAccountingSession();
  return createElement("p", null, `${chat.ledger.journalEntries.length} posted entries`);
}

function TrialBalanceRoute() {
  const { chat } = useAccountingSession();
  const report = getTrialBalanceReport(chat.ledger);
  if (report.status !== "ready") throw new Error(report.message);
  const { trialBalance } = report;
  return createElement("p", null, `${trialBalance.totalDebits} ${trialBalance.currency} debits; ${trialBalance.totalCredits} ${trialBalance.currency} credits`);
}

function ProfitLossRoute(filters: ProfitLossFilters = {}) {
  const { chat } = useAccountingSession();
  const report = getProfitLossReport(chat.ledger, filters);
  if (report.status !== "ready") throw new Error(report.message);
  const { profitAndLoss, currency } = report;
  return createElement("p", null, `${profitAndLoss.totalRevenue} ${currency} revenue; ${profitAndLoss.totalExpenses} ${currency} expenses; ${profitAndLoss.netIncome} ${currency} net profit / loss`);
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

  it("retains the same session through Chat, General Ledger, Trial Balance, filtered Profit & Loss, and back to Chat", async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    vi.stubGlobal("window", { localStorage: storage, sessionStorage: storage });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
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
    const balances = posted.ledger.balances;
    const snapshot = structuredClone(posted);

    const ledger = mounted.render(LedgerRoute);
    expect(ledger.html).toContain("1 posted entries");
    expect(ledger.session.chat).toBe(posted);
    expect(ledger.session.chat.ledger).toBe(posted.ledger);
    expect(ledger.session.chat.ledger.journalEntries).toEqual([result.suggestion.entry]);
    expect(ledger.session.chat.postingError).toBe("Review the existing entry.");
    expect(ledger.session.chat.reversalError).toBe("Reversal could not be created.");
    const reversalId = ledger.session.nextTransactionId("reversal");

    const trialBalance = mounted.render(TrialBalanceRoute);
    expect(trialBalance.html).toContain("700.125 KWD debits; 700.125 KWD credits");
    expect(trialBalance.session.chat).toBe(posted);
    expect(trialBalance.session.chat.ledger).toBe(posted.ledger);
    expect(trialBalance.session.chat.ledger.balances).toBe(balances);
    expect(trialBalance.session.chat.ledger.balances).toEqual(snapshot.ledger.balances);

    const profitLoss = mounted.render(ProfitLossRoute);
    expect(profitLoss.html).toContain("0 KWD revenue; 700.125 KWD expenses; -700.125 KWD net profit / loss");
    expect(profitLoss.session.chat).toBe(posted);
    expect(profitLoss.session.chat.ledger).toBe(posted.ledger);
    expect(profitLoss.session.chat.ledger.balances).toBe(balances);
    expect(profitLoss.session.chat).toEqual(snapshot);
    const filtered = mounted.render(() => ProfitLossRoute({ startDate: "2026-10-10" }));
    expect(filtered.html).toContain("0 KWD revenue; 0 KWD expenses; 0 KWD net profit / loss");
    expect(filtered.session.chat).toBe(posted);
    expect(filtered.session.chat).toEqual(snapshot);

    const returned = mounted.render(ChatRoute);
    expect(returned.session.chat).toBe(posted);
    expect(returned.session.chat.ledger).toBe(posted.ledger);
    expect(returned.session.chat.ledger.balances).toBe(balances);
    expect(returned.session.chat).toEqual(snapshot);
    expect(returned.html).toContain(result.text);
    expect(returned.session.chat.messages.at(-1)).toMatchObject({ transaction: { status: "posted" } });
    expect([
      id, reversalId, returned.session.nextTransactionId("suggestion"), first.nextTransactionId("reversal"),
    ]).toEqual(["chat-suggestion-1", "chat-reversal-2", "chat-suggestion-3", "chat-reversal-4"]);
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
  });

  it("keeps Profit & Loss consistent with shared reversal posting and preserves audit history through report navigation", async () => {
    const mounted = mountedSession();
    const first = mounted.render(ChatRoute).session;
    const id = first.nextTransactionId("suggestion");
    const result = await routeChatMessage("paid rent 700.125 KWD from bank", null, vi.fn(), { id, date: "2026-10-08" });
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected an accounting suggestion.");
    const audit = { timestamp: "2026-10-09T09:00:00.000Z" };
    const transaction = createSuggestedTransaction(result.suggestion, audit);
    first.setChat((current) => ({ ...current, messages: [...current.messages, { sender: "ai", text: result.text, transaction }] }));
    first.setChat((current) => ({ ...current, messages: approveChatTransaction(current.messages, id, audit) }));
    first.setChat((current) => postChatTransaction(current, id, audit));
    const original = mounted.render(ProfitLossRoute);
    expect(original.html).toContain("700.125 KWD expenses; -700.125 KWD net profit / loss");
    const reversalId = original.session.nextTransactionId("reversal");
    original.session.setChat((current) => reverseChatTransaction(current, id, reversalId, audit));
    const pending = mounted.render(ProfitLossRoute);
    expect(pending.html).toContain("700.125 KWD expenses; -700.125 KWD net profit / loss");
    expect(pending.session.chat.ledger.journalEntries).toHaveLength(1);
    pending.session.setChat((current) => ({ ...current, messages: approveChatTransaction(current.messages, reversalId, audit) }));
    const approved = mounted.render(ProfitLossRoute);
    expect(approved.html).toContain("700.125 KWD expenses; -700.125 KWD net profit / loss");
    approved.session.setChat((current) => postChatTransaction(current, reversalId, audit));
    const posted = mounted.render(ProfitLossRoute);
    expect(posted.html).toContain("0 KWD revenue; 0 KWD expenses; 0 KWD net profit / loss");
    expect(posted.session.chat.ledger.journalEntries.map((entry) => entry.id)).toEqual([id, reversalId]);
    const chat = posted.session.chat;
    const snapshot = structuredClone(chat);
    for (const Route of [LedgerRoute, TrialBalanceRoute, () => ProfitLossRoute({ startDate: "2026-10-08", endDate: "2026-10-08" }), ChatRoute]) {
      const navigated = mounted.render(Route);
      expect(navigated.session.chat).toBe(chat);
      expect(navigated.session.chat.ledger).toBe(chat.ledger);
      expect(navigated.session.chat).toEqual(snapshot);
    }
    const transactions = chat.messages.flatMap((message) => message.sender === "ai" && message.transaction ? [message.transaction] : []);
    const reversed = transactions.find((candidate) => candidate.suggestion.entry.id === id);
    const reversal = transactions.find((candidate) => candidate.suggestion.entry.id === reversalId);
    expect(reversed?.status).toBe("reversed");
    expect(reversal?.status).toBe("posted");
    expect(reversed?.auditEvents?.length).toBeGreaterThan(0);
    expect(reversal?.auditEvents?.length).toBeGreaterThan(0);
    expect(posted.session.nextTransactionId("suggestion")).toBe("chat-suggestion-3");
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
