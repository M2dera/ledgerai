import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfitLossPage from "@/app/profit-loss/page";
import ProfitLossReport from "@/components/profit-loss/ProfitLossReport";
import { useAccountingSession } from "@/components/providers/AccountingSessionProvider";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { classifyProfitAndLoss } from "@/lib/accounting/statements";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { createAccountingLedgerState, type AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import type { JournalEntry } from "@/lib/accounting/types";
import { approveChatTransaction, createChatState, postChatTransaction, reverseChatTransaction, type ChatState } from "@/lib/chat";

type HookFrame = { values: unknown[]; cursor: number };
const hooks = vi.hoisted(() => ({ active: null as HookFrame | null }));

// Exercise native date callbacks with the report tests' existing hook harness.
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
vi.mock("next/navigation", () => ({ usePathname: () => "/profit-loss" }));
vi.mock("@/components/providers/AccountingSessionProvider", () => ({ useAccountingSession: vi.fn() }));

afterEach(() => { hooks.active = null; vi.restoreAllMocks(); });

const originalId = "profit-loss-ui-rent";
const reversalId = "profit-loss-ui-reversal";
const statementAccounts = DEFAULT_CHART_OF_ACCOUNTS.filter(({ type }) => type === "revenue" || type === "expense");
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

function revenueEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "profit-loss-ui-revenue", date: "2026-10-01", description: "Services received", currency: "KWD",
    lines: [{ accountId: "bank", debit: 1_000.375, credit: 0 }, { accountId: "revenue", debit: 0, credit: 1_000.375 }],
    ...overrides,
  };
}

function capitalEntry(): JournalEntry {
  return {
    id: "profit-loss-ui-capital", date: "2026-10-09", description: "Owner contribution", currency: "KWD",
    lines: [{ accountId: "bank", debit: 100, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 100 }],
  };
}

function renderReport(ledger: AccountingLedgerState | null | undefined): string {
  return renderToStaticMarkup(createElement(ProfitLossReport, { ledger }));
}

function reportHarness(ledger: AccountingLedgerState) {
  const frame: HookFrame = { values: [], cursor: 0 };
  function render() {
    frame.cursor = 0;
    hooks.active = frame;
    try { return ProfitLossReport({ ledger }); } finally { hooks.active = null; }
  }
  return {
    html: () => renderToStaticMarkup(render()),
    change(id: "profit-loss-start-date" | "profit-loss-end-date", value: string) {
      const callback = elements(render()).find((element) => element.props.id === id)?.props.onChange;
      if (!callback) throw new Error(`Expected date filter ${id}.`);
      callback({ target: { value } });
    },
    clear() {
      const callback = elements(render()).find((element) => element.type === "button" && element.props.children === "Clear dates")?.props.onClick;
      if (!callback) throw new Error("Expected Clear dates action.");
      callback();
    },
  };
}

function tableRows(html: string): string[] {
  const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  if (!body) throw new Error("Expected account breakdown table.");
  return body.match(/<tr\b[\s\S]*?<\/tr>/g) ?? [];
}

function amountNumber(text: string): number {
  return Number(text.replace(/ KWD$/, "").replace(/,/g, ""));
}

function accountAmount(html: string, code: string): number {
  const row = tableRows(html).find((candidate) => candidate.includes(`>${code}</td>`));
  if (!row) throw new Error(`Expected account ${code}.`);
  const amounts = [...row.matchAll(/<td\b[^>]*>(.*?)<\/td>/g)];
  return amountNumber(amounts.at(-1)![1]);
}

function summaryAmount(html: string, label: string): number {
  const amount = html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>(.*?)</dd>`))?.[1];
  if (amount === undefined) throw new Error(`Expected ${label}.`);
  return amountNumber(amount);
}

function freezeRecursively(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

describe("Profit & Loss UI", () => {
  it("displays core totals and only classified revenue and expense accounts with explicit currency and precision", () => {
    const entries = [revenueEntry(), ...postedState().ledger.journalEntries, capitalEntry()];
    const ledger = createAccountingLedgerState(entries);
    const statement = classifyProfitAndLoss(entries, DEFAULT_CHART_OF_ACCOUNTS);
    const html = renderReport(ledger);

    expect(summaryAmount(html, "Total revenue")).toBe(statement.totalRevenue);
    expect(summaryAmount(html, "Total expenses")).toBe(statement.totalExpenses);
    expect(summaryAmount(html, "Net profit / loss")).toBe(statement.netIncome);
    expect(tableRows(html)).toHaveLength(statementAccounts.length);
    for (const line of [...statement.revenue, ...statement.expenses]) {
      expect(accountAmount(html, line.account.code)).toBe(line.balance);
    }
    for (const account of DEFAULT_CHART_OF_ACCOUNTS.filter(({ type }) => type !== "revenue" && type !== "expense")) {
      expect(tableRows(html).some((row) => row.includes(`>${account.code}</td>`))).toBe(false);
    }
    expect(html).toContain(">KWD</span>");
    expect(html).toContain(">1,000.375 KWD</dd>");
    expect(html).toContain(">700.125 KWD</td>");
    expect(html).toContain(">300.25 KWD</dd>");
    expect(html).toContain(">Revenue</td>");
    expect(html).toContain(">Expense</td>");
    expect(html).toContain("Account breakdown");
    for (const heading of ["Account code", "Account name", "Classification", "Amount"]) expect(html).toContain(`>${heading}</th>`);
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("<caption");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="region"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("sm:grid-cols-3");
  });

  it.each(["draft", "awaiting_approval", "approved"] as const)("excludes %s suggestions and explains how to establish posted activity", (status) => {
    const html = renderReport(stateFor(status).ledger);
    expect(html).toContain("No posted journal entries yet");
    expect(html).toContain("approve it, then post it");
    expect(html).toContain('href="/chat"');
    expect(html).toContain("Open AI Analyst");
    expect(html).toContain("cleared on page refresh");
    expect(html).toContain("Not established");
    expect(html).toContain("0 posted entries included");
    expect(tableRows(html)).toHaveLength(statementAccounts.length);
    for (const account of statementAccounts) expect(accountAmount(html, account.code)).toBe(0);
    expect(summaryAmount(html, "Total revenue")).toBe(0);
    expect(summaryAmount(html, "Total expenses")).toBe(0);
    expect(summaryAmount(html, "Net profit / loss")).toBe(0);
  });

  it("shows a net loss and offsets the original only after reversal posting without calling net-zero activity empty", () => {
    const original = postedState();
    const pending = reverseChatTransaction(original, originalId, reversalId);
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, reversalId) };
    for (const state of [original, pending, approved]) {
      const html = renderReport(state.ledger);
      expect(accountAmount(html, "5000")).toBe(700.125);
      expect(summaryAmount(html, "Net profit / loss")).toBe(-700.125);
      expect(html).toContain(">-700.125 KWD</dd>");
      expect(html).toContain("1 posted entry included");
    }
    const posted = postChatTransaction(approved, reversalId);
    const html = renderReport(posted.ledger);
    expect(html).toContain("2 posted entries included");
    expect(accountAmount(html, "5000")).toBe(0);
    expect(summaryAmount(html, "Total expenses")).toBe(0);
    expect(summaryAmount(html, "Net profit / loss")).toBe(0);
    expect(html).not.toContain("No posted revenue or expense activity");
    expect(posted.ledger.journalEntries.map(({ id }) => id)).toEqual([originalId, reversalId]);
  });

  it("preserves negative revenue and expense balances from valid contra movements", () => {
    const ledger = createAccountingLedgerState([
      revenueEntry({ lines: [{ accountId: "revenue", debit: 15.125, credit: 0 }, { accountId: "bank", debit: 0, credit: 15.125 }] }),
      { ...postedState().ledger.journalEntries[0], lines: [{ accountId: "bank", debit: 20.25, credit: 0 }, { accountId: "rent-expense", debit: 0, credit: 20.25 }] },
    ]);
    const html = renderReport(ledger);
    expect(accountAmount(html, "4000")).toBe(-15.125);
    expect(accountAmount(html, "5000")).toBe(-20.25);
    expect(summaryAmount(html, "Total revenue")).toBe(-15.125);
    expect(summaryAmount(html, "Total expenses")).toBe(-20.25);
    expect(summaryAmount(html, "Net profit / loss")).toBe(5.125);
  });

  it("keeps tiny nonzero core amounts visible without rounding them to zero", () => {
    const ledger = createAccountingLedgerState([revenueEntry({
      lines: [{ accountId: "bank", debit: 1e-21, credit: 0 }, { accountId: "revenue", debit: 0, credit: 1e-21 }],
    })]);
    const html = renderReport(ledger);
    expect(summaryAmount(html, "Total revenue")).toBe(1e-21);
    expect(summaryAmount(html, "Net profit / loss")).toBe(1e-21);
    expect(accountAmount(html, "4000")).toBe(1e-21);
    expect(html).toContain(">1e-21 KWD</dd>");
    expect(html).not.toContain("No posted revenue or expense activity");
  });

  it("applies inclusive start-only, end-only, and bounded journal-date filters, then clears both dates", () => {
    const ui = reportHarness(createAccountingLedgerState([revenueEntry(), ...postedState().ledger.journalEntries, capitalEntry()]));
    ui.change("profit-loss-start-date", "2026-10-08");
    expect(summaryAmount(ui.html(), "Total revenue")).toBe(0);
    expect(summaryAmount(ui.html(), "Total expenses")).toBe(700.125);
    ui.change("profit-loss-end-date", "2026-10-08");
    const bounded = ui.html();
    expect(bounded).toContain("1 posted entry included");
    expect(summaryAmount(bounded, "Net profit / loss")).toBe(-700.125);
    expect(bounded).toContain('for="profit-loss-start-date"');
    expect(bounded).toContain('for="profit-loss-end-date"');
    expect(bounded).toContain("Start date (inclusive)");
    expect(bounded).toContain("End date (inclusive)");
    expect(bounded.match(/type="date"/g)).toHaveLength(2);
    expect(bounded).toContain("aria-describedby=");
    ui.change("profit-loss-start-date", "");
    ui.change("profit-loss-end-date", "2026-10-01");
    expect(summaryAmount(ui.html(), "Total revenue")).toBe(1_000.375);
    expect(summaryAmount(ui.html(), "Total expenses")).toBe(0);
    ui.clear();
    expect(ui.html()).toContain("All posted entries");
    expect(ui.html()).toContain("3 posted entries included");
    expect(summaryAmount(ui.html(), "Net profit / loss")).toBe(300.25);
    expect(ui.html()).not.toContain('value="2026-10-01"');
    expect(ui.html()).not.toContain('value="2026-10-08"');
  });

  it("filters each posted reversal by its actual journal date", () => {
    const original = postedState();
    const pending = reverseChatTransaction(original, originalId, reversalId);
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, reversalId) };
    const posted = postChatTransaction(approved, reversalId);
    const entries = posted.ledger.journalEntries.map((entry) => entry.id === reversalId ? { ...entry, date: "2026-10-09" } : entry);
    const ui = reportHarness(createAccountingLedgerState(entries));
    ui.change("profit-loss-end-date", "2026-10-08");
    expect(summaryAmount(ui.html(), "Total expenses")).toBe(700.125);
    ui.change("profit-loss-end-date", "2026-10-09");
    expect(summaryAmount(ui.html(), "Total expenses")).toBe(0);
    ui.change("profit-loss-start-date", "2026-10-09");
    expect(summaryAmount(ui.html(), "Total expenses")).toBe(-700.125);
    expect(summaryAmount(ui.html(), "Net profit / loss")).toBe(700.125);
  });

  it("distinguishes no revenue/expense activity from an empty ledger and retains currency in an empty period", () => {
    const capital = renderReport(createAccountingLedgerState([capitalEntry()]));
    expect(capital).toContain("No posted revenue or expense activity");
    expect(capital).toContain('role="status"');
    expect(capital).not.toContain("No posted journal entries yet");
    expect(capital).toContain(">0 KWD</dd>");
    const ui = reportHarness(postedState().ledger);
    ui.change("profit-loss-start-date", "2026-10-09");
    const html = ui.html();
    expect(html).toContain("No posted revenue or expense activity");
    expect(html).toContain('role="status"');
    expect(html).toContain("0 posted entries included");
    expect(html).toContain(">KWD</span>");
    expect(html).toContain(">0 KWD</dd>");
    expect(html).not.toContain("Not established");
    expect(html).not.toContain("No posted journal entries yet");
    ui.clear();
    expect(ui.html()).not.toContain("No posted revenue or expense activity");
  });

  it("shows no financial amounts or table for unavailable, malformed, or invalid-currency data", () => {
    const source = postedState().ledger;
    const malformed = { ...source, journalEntries: [{ ...source.journalEntries[0], lines: [] }] };
    const missingCurrency = { ...source, journalEntries: [{ ...source.journalEntries[0], currency: "" }] };
    const invalidCurrency = { ...source, journalEntries: [{ ...source.journalEntries[0], currency: "UNKNOWN" }] };
    for (const ledger of [null, undefined, malformed, missingCurrency, invalidCurrency]) {
      const html = renderReport(ledger);
      expect(html).toContain('role="alert"');
      expect(html).toContain("Unable to display Profit &amp; Loss");
      expect(html).not.toContain("<dd");
      expect(html).not.toContain("<table");
    }
  });

  it("does not hide mixed source currencies by filtering out one currency", () => {
    const source = postedState().ledger;
    const mixed = { ...source, journalEntries: [...source.journalEntries, revenueEntry({ currency: "USD" })] };
    const ui = reportHarness(mixed);
    for (const select of [() => undefined, () => ui.change("profit-loss-start-date", "2026-10-08")]) {
      select();
      expect(ui.html()).toContain('role="alert"');
      expect(ui.html()).not.toContain("<dd");
      expect(ui.html()).not.toContain("<table");
    }
  });

  it("rejects invalid or reversed filter dates and allows recovery by clearing them", () => {
    const ui = reportHarness(postedState().ledger);
    ui.change("profit-loss-start-date", "2026-10-09");
    ui.change("profit-loss-end-date", "2026-10-08");
    expect(ui.html()).toContain("The start date must be on or before the end date.");
    expect(ui.html()).toContain('role="alert"');
    expect(ui.html()).not.toContain("<dd");
    ui.clear();
    ui.change("profit-loss-end-date", "2026-02-30");
    expect(ui.html()).toContain('role="alert"');
    expect(ui.html()).not.toContain("<table");
    ui.clear();
    expect(ui.html()).not.toContain('role="alert"');
    expect(summaryAmount(ui.html(), "Total expenses")).toBe(700.125);
  });

  it.each(["", "2026-02-30"])("rejects filtered reports with an unknown source journal date %s and keeps the all-entry view available", (date) => {
    const ui = reportHarness(createAccountingLedgerState([revenueEntry({ date })]));
    expect(summaryAmount(ui.html(), "Total revenue")).toBe(1_000.375);
    expect(ui.html()).toContain("1 posted entry has no valid journal date.");
    expect(ui.html()).toContain("Their amounts are included in this all-posted report; period filtering requires valid journal dates.");
    expect(ui.html()).toContain('role="status"');
    ui.change("profit-loss-start-date", "2026-10-01");
    expect(ui.html()).toContain('role="alert"');
    expect(ui.html()).not.toContain("<dd");
    expect(ui.html()).not.toContain("<table");
    ui.clear();
    expect(ui.html()).not.toContain('role="alert"');
    expect(summaryAmount(ui.html(), "Total revenue")).toBe(1_000.375);
  });

  it("does not mutate a frozen ledger when viewed, filtered, or cleared", () => {
    const ledger = createAccountingLedgerState([revenueEntry(), ...postedState().ledger.journalEntries]);
    const snapshot = structuredClone(ledger);
    freezeRecursively(ledger);
    const ui = reportHarness(ledger);
    ui.html();
    ui.change("profit-loss-start-date", "2026-10-08");
    ui.html();
    ui.change("profit-loss-end-date", "2026-10-08");
    ui.html();
    ui.clear();
    ui.html();
    expect(ledger).toEqual(snapshot);
    expect(ledger.journalEntries.map(({ id }) => id)).toEqual(["profit-loss-ui-revenue", originalId]);
  });

  it("reads the shared ledger on /profit-loss and marks its sidebar link active", () => {
    const chat = postedState();
    vi.mocked(useAccountingSession).mockReturnValue({ chat, setChat: vi.fn(), nextTransactionId: vi.fn() });
    const page = ProfitLossPage();
    const component = elements(page).find((element) => element.type === ProfitLossReport) as ReactElement<ComponentProps<typeof ProfitLossReport>> | undefined;
    expect(component?.props.ledger).toBe(chat.ledger);
    const html = renderToStaticMarkup(page);
    const profitLossLink = html.match(/<a\b[^>]*href="\/profit-loss"[^>]*>Profit &amp; Loss<\/a>/)?.[0];
    expect(profitLossLink).toContain('aria-current="page"');
    expect(html).toContain(">Profit &amp; Loss</h1>");
    expect(accountAmount(html, "5000")).toBe(700.125);
  });
});
