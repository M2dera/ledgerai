import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import GeneralLedgerPage from "@/app/ledger/page";
import GeneralLedger from "@/components/ledger/GeneralLedger";
import { useAccountingSession } from "@/components/providers/AccountingSessionProvider";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateAccountBalance, calculateLedgerTotals } from "@/lib/accounting/ledger";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { createAccountingLedgerState, type AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import type { JournalEntry } from "@/lib/accounting/types";
import { approveChatTransaction, createChatState, postChatTransaction, reverseChatTransaction, type ChatState } from "@/lib/chat";

type HookFrame = { values: unknown[]; cursor: number };
const hooks = vi.hoisted(() => ({ active: null as HookFrame | null }));

// Exercise native filter callbacks with the existing lightweight hook harness.
// Static renders still use React's own hooks, without adding a DOM dependency.
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
    useMemo(factory: () => unknown, dependencies: unknown[]) {
      return hooks.active ? factory() : actual.useMemo(factory, dependencies);
    },
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/ledger" }));
vi.mock("@/components/providers/AccountingSessionProvider", () => ({ useAccountingSession: vi.fn() }));

afterEach(() => {
  hooks.active = null;
  vi.restoreAllMocks();
});

const originalId = "ledger-ui-rent";
const reversalId = "ledger-ui-rent-reversal";
type NodeProps = {
  children?: ReactNode;
  id?: string;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
};

function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<NodeProps>(node)) return [];
  return [node, ...elements(node.props.children)];
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

function renderLedger(ledger: AccountingLedgerState | null | undefined): string {
  return renderToStaticMarkup(createElement(GeneralLedger, { ledger }));
}

function ledgerHarness(ledger: AccountingLedgerState) {
  const frame: HookFrame = { values: [], cursor: 0 };
  function render() {
    frame.cursor = 0;
    hooks.active = frame;
    try { return GeneralLedger({ ledger }); } finally { hooks.active = null; }
  }
  return {
    render,
    html: () => renderToStaticMarkup(render()),
    change(id: string, value: string) {
      const callback = elements(render()).find((element) => element.props.id === id)?.props.onChange;
      if (!callback) throw new Error(`Expected filter ${id}.`);
      callback({ target: { value } });
    },
    clear() {
      const callback = elements(render()).find((element) => element.type === "button" && element.props.children === "Clear filters")?.props.onClick;
      if (!callback) throw new Error("Expected Clear filters action.");
      callback();
    },
  };
}

function capitalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "ledger-capital", date: "2026-10-01", description: "Owner contribution", currency: "KWD",
    lines: [{ accountId: "bank", debit: 1_000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1_000 }],
    ...overrides,
  };
}

function freezeRecursively(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

describe("General Ledger UI", () => {
  it("shows actual posted lines with labeled columns, explicit currency, and decimal precision", () => {
    const state = postedState();
    const html = renderLedger(state.ledger);
    const totals = calculateLedgerTotals(state.ledger.journalEntries, DEFAULT_CHART_OF_ACCOUNTS);

    expect(html).toContain("2026-10-08");
    expect(html.match(new RegExp(`>${originalId}</td>`, "g"))).toHaveLength(2);
    expect(html).toContain("paid rent 700.125 KWD from bank");
    expect(html).toContain("Rent Expense");
    expect(html).toContain(">Bank</span>");
    expect(html).toContain(`>${totals.debitTotal} KWD</dd>`);
    expect(html).toContain(`>${totals.creditTotal} KWD</dd>`);
    expect(html).not.toContain("700.13");
    expect(html).toContain('scope="col"');
    expect(html).toContain(">Debit</th>");
    expect(html).toContain(">Credit</th>");
    expect(html).toContain("<caption");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="region"');
    expect(html).not.toContain("Account balance");
    expect(html).not.toContain("Running balance");
  });

  it.each(["draft", "awaiting_approval", "approved"] as const)("excludes %s suggestions and shows the session-only empty state", (status) => {
    const html = renderLedger(stateFor(status).ledger);
    expect(html).toContain("No posted journal entries yet");
    expect(html).toContain("approve it, then post it");
    expect(html).toContain('href="/chat"');
    expect(html).toContain("cleared on page refresh");
    expect(html).toContain("Not established");
    expect(html).not.toContain(originalId);
    expect(html).not.toContain("<table");
  });

  it("shows the reversal only after posting and keeps both posted transactions visible", () => {
    const original = postedState();
    const pending = reverseChatTransaction(original, originalId, reversalId);
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, reversalId) };

    for (const state of [pending, approved]) {
      const html = renderLedger(state.ledger);
      expect(html).toContain(`>${originalId}</td>`);
      expect(html).not.toContain(`>${reversalId}</td>`);
    }

    const posted = postChatTransaction(approved, reversalId);
    const html = renderLedger(posted.ledger);
    expect(html.match(new RegExp(`>${originalId}</td>`, "g"))).toHaveLength(2);
    expect(html.match(new RegExp(`>${reversalId}</td>`, "g"))).toHaveLength(2);
    const ui = ledgerHarness(posted.ledger);
    ui.change("ledger-account", "rent-expense");
    expect(ui.html()).toContain(">0 KWD</dd>");
    expect(posted.ledger.balances.find(({ account }) => account.id === "rent-expense")?.balance).toBe(0);
    expect(ui.html()).toContain(`>${originalId}</td>`);
    expect(ui.html()).toContain(`>${reversalId}</td>`);
  });

  it("filters account lines and displays Accounting Core totals and the correct normal balance", () => {
    const state = postedState();
    const ui = ledgerHarness(state.ledger);
    ui.change("ledger-account", "bank");
    const account = DEFAULT_CHART_OF_ACCOUNTS.find(({ id }) => id === "bank")!;
    const balance = calculateAccountBalance(account, state.ledger.journalEntries, DEFAULT_CHART_OF_ACCOUNTS);
    const html = ui.html();
    const table = html.slice(html.indexOf("<tbody"));

    expect(table).toContain(">Bank</span>");
    expect(table).not.toContain("Rent Expense");
    expect(table.match(new RegExp(`>${originalId}</td>`, "g"))).toHaveLength(1);
    expect(html).toContain(`>${balance.debitTotal} KWD</dd>`);
    expect(html).toContain(`>${balance.creditTotal} KWD</dd>`);
    expect(html).toContain(`>${balance.balance} KWD</dd>`);
    expect(html).toContain("Account balance");
    expect(html).toContain("debit total minus credit total");

    const capital = ledgerHarness(createAccountingLedgerState([capitalEntry()]));
    capital.change("ledger-account", "owners-equity");
    expect(capital.html()).toContain("credit total minus debit total");
    expect(capital.html()).toContain(">1,000 KWD</dd>");
  });

  it("applies inclusive period filters, labels period balance, and clears every filter", () => {
    const posted = postedState();
    const ledger = createAccountingLedgerState([capitalEntry(), ...posted.ledger.journalEntries]);
    const ui = ledgerHarness(ledger);
    ui.change("ledger-account", "bank");
    ui.change("ledger-start-date", "2026-10-08");
    ui.change("ledger-end-date", "2026-10-08");
    const html = ui.html();

    expect(html).toContain(`>${originalId}</td>`);
    expect(html).not.toContain(">ledger-capital</td>");
    expect(html).toContain("Period balance");
    expect(html).toContain("excludes the opening balance");
    expect(html).toContain(">-700.125 KWD</dd>");
    expect(html).toContain('for="ledger-start-date"');
    expect(html).toContain('for="ledger-end-date"');
    expect(html).toContain('type="date"');

    ui.clear();
    const cleared = ui.html();
    expect(cleared).toContain(">ledger-capital</td>");
    expect(cleared).toContain(`>${originalId}</td>`);
    expect(cleared).not.toContain("Period balance");
    expect(cleared).not.toContain("Account balance");
    expect(cleared).not.toContain('value="2026-10-08"');
  });

  it("distinguishes no filter matches from an empty ledger and preserves currency on a zero period", () => {
    const ui = ledgerHarness(postedState().ledger);
    ui.change("ledger-account", "cash");
    expect(ui.html()).toContain("No journal lines match these filters");
    expect(ui.html()).not.toContain("No posted journal entries yet");
    expect(ui.html()).toContain(">0 KWD</dd>");

    ui.change("ledger-start-date", "2026-10-09");
    expect(ui.html()).toContain("No journal lines match these filters");
    expect(ui.html()).toContain(">KWD</span>");
    expect(ui.html()).toContain(">0 KWD</dd>");
    expect(ui.html()).not.toContain("Not established");
    ui.clear();
    expect(ui.html()).toContain(`>${originalId}</td>`);
  });

  it("marks invalid dates as unavailable and explains their exclusion from period totals", () => {
    const ledger = createAccountingLedgerState([capitalEntry({ date: "2026-02-30" })]);
    const ui = ledgerHarness(ledger);
    expect(ui.html()).toContain("Date unavailable");
    expect(ui.html()).toContain("Their lines and amounts are included");
    expect(ui.html()).toContain(">1,000 KWD</dd>");
    ui.change("ledger-start-date", "2026-01-01");
    expect(ui.html()).toContain("excluded from the selected period and its totals");
    expect(ui.html()).toContain("No journal lines match these filters");
    expect(ui.html()).not.toContain(">ledger-capital</td>");
    expect(ui.html()).toContain(">0 KWD</dd>");
  });

  it("shows a safe error with no amounts for unavailable and mixed-currency data", () => {
    const source = postedState().ledger;
    const mixed = { ...source, journalEntries: [...source.journalEntries, capitalEntry({ currency: "USD" })] };
    for (const ledger of [null, undefined, mixed]) {
      const html = renderLedger(ledger);
      expect(html).toContain('role="alert"');
      expect(html).toContain("Unable to display the General Ledger");
      expect(html).not.toContain("<dd");
      expect(html).not.toContain("<table");
    }
  });

  it("allows a reversed date range to be corrected by clearing the filters", () => {
    const ui = ledgerHarness(postedState().ledger);
    ui.change("ledger-start-date", "2026-10-09");
    ui.change("ledger-end-date", "2026-10-08");
    expect(ui.html()).toContain("The start date must be on or before the end date.");
    expect(ui.html()).not.toContain("<dd");
    ui.clear();
    expect(ui.html()).toContain(`>${originalId}</td>`);
    expect(ui.html()).not.toContain('role="alert"');
  });

  it("does not mutate a frozen ledger when viewed, filtered, or cleared", () => {
    const ledger = createAccountingLedgerState([capitalEntry(), ...postedState().ledger.journalEntries]);
    const snapshot = structuredClone(ledger);
    freezeRecursively(ledger);
    const ui = ledgerHarness(ledger);
    ui.html();
    ui.change("ledger-account", "bank");
    ui.change("ledger-end-date", "2026-10-01");
    ui.html();
    ui.clear();
    ui.html();
    expect(ledger).toEqual(snapshot);
    expect(ledger.journalEntries.map(({ id }) => id)).toEqual(["ledger-capital", originalId]);
  });

  it("reads the shared session ledger on /ledger and exposes its active navigation link", () => {
    const chat = postedState();
    vi.mocked(useAccountingSession).mockReturnValue({ chat, setChat: vi.fn(), nextTransactionId: vi.fn() });
    const page = GeneralLedgerPage();
    const component = elements(page).find((element) => element.type === GeneralLedger) as ReactElement<ComponentProps<typeof GeneralLedger>> | undefined;
    expect(component?.props.ledger).toBe(chat.ledger);
    const html = renderToStaticMarkup(page);
    const ledgerLink = html.match(/<a\b[^>]*href="\/ledger"[^>]*>General Ledger<\/a>/)?.[0];
    expect(ledgerLink).toContain('aria-current="page"');
    expect(html).toContain(">General Ledger</h1>");
    expect(html).toContain(`>${originalId}</td>`);
  });
});
