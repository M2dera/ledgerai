import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import BalanceSheetPage from "@/app/balance-sheet/page";
import BalanceSheetReport from "@/components/balance-sheet/BalanceSheetReport";
import { useAccountingSession } from "@/components/providers/AccountingSessionProvider";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { createAccountingLedgerState, type AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import type { JournalEntry } from "@/lib/accounting/types";
import { getBalanceSheetReport } from "@/lib/balance-sheet";
import { approveChatTransaction, createChatState, postChatTransaction, reverseChatTransaction, type ChatState } from "@/lib/chat";

type HookFrame = { values: unknown[]; cursor: number };
const hooks = vi.hoisted(() => ({ active: null as HookFrame | null }));

// Keep the report tests' existing lightweight harness for native filter callbacks.
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
vi.mock("next/navigation", () => ({ usePathname: () => "/balance-sheet" }));
vi.mock("@/components/providers/AccountingSessionProvider", () => ({ useAccountingSession: vi.fn() }));

afterEach(() => { hooks.active = null; vi.restoreAllMocks(); });

const originalId = "balance-sheet-ui-rent";
const reversalId = "balance-sheet-ui-reversal";
const statementAccounts = DEFAULT_CHART_OF_ACCOUNTS.filter(({ type }) => type === "asset" || type === "liability" || type === "equity");
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

function capitalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "balance-sheet-ui-capital", date: "2026-10-01", description: "Owner contribution", currency: "KWD",
    lines: [{ accountId: "bank", debit: 1_000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1_000 }],
    ...overrides,
  };
}

function revenueEntry(): JournalEntry {
  return {
    id: "balance-sheet-ui-revenue", date: "2026-10-02", description: "Services received", currency: "KWD",
    lines: [{ accountId: "bank", debit: 1_000.375, credit: 0 }, { accountId: "revenue", debit: 0, credit: 1_000.375 }],
  };
}

function liabilityEntry(): JournalEntry {
  return {
    id: "balance-sheet-ui-equipment", date: "2026-10-05", description: "Equipment payable", currency: "KWD",
    lines: [{ accountId: "computer-equipment", debit: 250.5, credit: 0 }, { accountId: "accounts-payable", debit: 0, credit: 250.5 }],
  };
}

function renderReport(ledger: AccountingLedgerState | null | undefined): string {
  return renderToStaticMarkup(createElement(BalanceSheetReport, { ledger }));
}

function reportHarness(ledger: AccountingLedgerState) {
  const frame: HookFrame = { values: [], cursor: 0 };
  function render() {
    frame.cursor = 0;
    hooks.active = frame;
    try { return BalanceSheetReport({ ledger }); } finally { hooks.active = null; }
  }
  return {
    html: () => renderToStaticMarkup(render()),
    setDate(value: string) {
      const callback = elements(render()).find((element) => element.props.id === "balance-sheet-date")?.props.onChange;
      if (!callback) throw new Error("Expected As of date filter.");
      callback({ target: { value } });
    },
    clear() {
      const callback = elements(render()).find((element) => element.type === "button" && element.props.children === "Clear date")?.props.onClick;
      if (!callback) throw new Error("Expected Clear date action.");
      callback();
    },
  };
}

function tableRows(html: string): string[] {
  const bodies = [...html.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/g)];
  if (!bodies.length) throw new Error("Expected Balance Sheet account tables.");
  return bodies.flatMap((body) => body[1].match(/<tr\b[\s\S]*?<\/tr>/g) ?? []);
}

function amountNumber(text: string): number {
  return Number(text.replace(/ KWD$/, "").replace(/,/g, ""));
}

function rowAmount(row: string): number {
  const amounts = [...row.matchAll(/<td\b[^>]*>(.*?)<\/td>/g)];
  return amountNumber(amounts.at(-1)![1]);
}

function accountAmount(html: string, code: string): number {
  const row = tableRows(html).find((candidate) => candidate.includes(`>${code}</td>`));
  if (!row) throw new Error(`Expected account ${code}.`);
  return rowAmount(row);
}

function earningsAmount(html: string): number {
  const row = tableRows(html).find((candidate) => candidate.includes("Current earnings / Net income"));
  if (!row) throw new Error("Expected the distinct current earnings row.");
  return rowAmount(row);
}

function summaryAmount(html: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const amount = html.match(new RegExp(`<dt[^>]*>${escaped}</dt><dd[^>]*>(.*?)</dd>`))?.[1];
  if (amount === undefined) throw new Error(`Expected ${label}.`);
  return amountNumber(amount);
}

function freezeRecursively(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

describe("Balance Sheet UI", () => {
  it("displays classified accounts, transparent current earnings, and core totals with currency and accessible sections", () => {
    const ledger = createAccountingLedgerState([capitalEntry(), revenueEntry(), liabilityEntry(), ...postedState().ledger.journalEntries]);
    const report = getBalanceSheetReport(ledger);
    if (report.status !== "ready") throw new Error(report.message);
    const html = renderReport(ledger);
    const statement = report.balanceSheet;

    for (const [label, value] of [
      ["Total assets", statement.totalAssets], ["Total liabilities", statement.totalLiabilities],
      ["Total equity", statement.totalEquity], ["Total liabilities + equity", statement.totalLiabilitiesAndEquity], ["Difference", statement.difference],
    ] as const) expect(summaryAmount(html, label)).toBe(value);
    expect(summaryAmount(html, "Total assets")).toBe(1_550.75);
    expect(summaryAmount(html, "Total liabilities")).toBe(250.5);
    expect(summaryAmount(html, "Total equity")).toBe(1_300.25);
    expect(earningsAmount(html)).toBe(300.25);
    expect(accountAmount(html, "3000")).toBe(1_000);
    for (const line of [...statement.assets, ...statement.liabilities, ...statement.equity]) {
      expect(accountAmount(html, line.account.code)).toBe(line.balance);
    }
    for (const account of DEFAULT_CHART_OF_ACCOUNTS.filter(({ type }) => type === "revenue" || type === "expense")) {
      expect(tableRows(html).some((row) => row.includes(`>${account.code}</td>`))).toBe(false);
    }
    expect(html).toContain(">Balanced</p>");
    expect(html).not.toContain("Out of balance");
    expect(html).toContain("Assets = Liabilities + Equity");
    expect(html).toContain("0.000000001");
    expect(html).toContain(">KWD</span>");
    expect(html).toContain(">1,550.75 KWD</dd>");
    expect(html).toContain(">1,300.25 KWD</td>");
    for (const heading of ["Assets", "Liabilities", "Equity"]) expect(html).toContain(`>${heading}</h2>`);
    for (const heading of ["Account code", "Account name", "Classification", "Balance"]) expect(html.match(new RegExp(`>${heading}</th>`, "g"))).toHaveLength(3);
    expect(html.match(/<caption\b/g)).toHaveLength(3);
    expect(html.match(/role="region"/g)).toHaveLength(3);
    expect(html.match(/tabindex="0"/g)).toHaveLength(3);
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("lg:grid-cols-3");
  });

  it.each(["draft", "awaiting_approval", "approved"] as const)("excludes %s suggestions and renders zero accounts without assuming a currency", (status) => {
    const html = renderReport(stateFor(status).ledger);
    expect(html).toContain("No posted journal entries yet");
    expect(html).toContain("approve it, then post it");
    expect(html).toContain('href="/chat"');
    expect(html).toContain("Open AI Analyst");
    expect(html).toContain("cleared on page refresh");
    expect(html).toContain("Not established");
    expect(html).toContain("0 posted entries included");
    for (const account of statementAccounts) expect(accountAmount(html, account.code)).toBe(0);
    for (const label of ["Total assets", "Total liabilities", "Total equity", "Total liabilities + equity", "Difference"]) expect(summaryAmount(html, label)).toBe(0);
    expect(earningsAmount(html)).toBe(0);
    expect(html).toContain(">Balanced</p>");
  });

  it("includes signed current losses and offsets original balances only after reversal posting", () => {
    const original = postedState();
    const pending = reverseChatTransaction(original, originalId, reversalId);
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, reversalId) };
    for (const state of [original, pending, approved]) {
      const html = renderReport(state.ledger);
      expect(accountAmount(html, "1010")).toBe(-700.125);
      expect(accountAmount(html, "3000")).toBe(0);
      expect(earningsAmount(html)).toBe(-700.125);
      expect(summaryAmount(html, "Total equity")).toBe(-700.125);
      expect(summaryAmount(html, "Total assets")).toBe(-700.125);
      expect(html).toContain(">-700.125 KWD</td>");
      expect(html).toContain(">Balanced</p>");
      expect(html).toContain("1 posted entry included");
    }
    const posted = postChatTransaction(approved, reversalId);
    const html = renderReport(posted.ledger);
    expect(html).toContain("2 posted entries included");
    expect(accountAmount(html, "1010")).toBe(0);
    expect(earningsAmount(html)).toBe(0);
    expect(summaryAmount(html, "Total assets")).toBe(0);
    expect(summaryAmount(html, "Total equity")).toBe(0);
    expect(html).not.toContain("No posted journal entries yet");
    expect(posted.ledger.journalEntries.map(({ id }) => id)).toEqual([originalId, reversalId]);
  });

  it("preserves negative liability and equity account balances", () => {
    const ledger = createAccountingLedgerState([
      capitalEntry({ lines: [{ accountId: "owners-equity", debit: 25.125, credit: 0 }, { accountId: "bank", debit: 0, credit: 25.125 }] }),
      { ...liabilityEntry(), lines: [{ accountId: "accounts-payable", debit: 20.25, credit: 0 }, { accountId: "bank", debit: 0, credit: 20.25 }] },
    ]);
    const html = renderReport(ledger);
    expect(accountAmount(html, "2000")).toBe(-20.25);
    expect(accountAmount(html, "3000")).toBe(-25.125);
    expect(summaryAmount(html, "Total assets")).toBe(-45.375);
    expect(summaryAmount(html, "Total liabilities")).toBe(-20.25);
    expect(summaryAmount(html, "Total equity")).toBe(-25.125);
    expect(html).toContain(">Balanced</p>");
  });

  it("calculates cumulative inclusive as-of balances and earnings, then restores every posted entry when cleared", () => {
    const ledger = createAccountingLedgerState([capitalEntry(), revenueEntry(), liabilityEntry(), ...postedState().ledger.journalEntries]);
    const ui = reportHarness(ledger);
    ui.setDate("2026-10-01");
    expect(ui.html()).toContain("As of 2026-10-01");
    expect(ui.html()).toContain("1 posted entry included");
    expect(summaryAmount(ui.html(), "Total assets")).toBe(1_000);
    expect(earningsAmount(ui.html())).toBe(0);
    ui.setDate("2026-10-02");
    expect(summaryAmount(ui.html(), "Total assets")).toBe(2_000.375);
    expect(summaryAmount(ui.html(), "Total equity")).toBe(2_000.375);
    expect(earningsAmount(ui.html())).toBe(1_000.375);
    expect(accountAmount(ui.html(), "3000")).toBe(1_000);
    ui.setDate("2026-10-08");
    const inclusive = ui.html();
    expect(summaryAmount(inclusive, "Total assets")).toBe(1_550.75);
    expect(earningsAmount(inclusive)).toBe(300.25);
    expect(inclusive).toContain('for="balance-sheet-date"');
    expect(inclusive).toContain("As of date (inclusive)");
    expect(inclusive).toContain('type="date"');
    expect(inclusive).toContain('aria-describedby="balance-sheet-date-help"');
    ui.clear();
    expect(ui.html()).toContain("All posted entries");
    expect(ui.html()).toContain("4 posted entries included");
    expect(ui.html()).not.toContain('value="2026-10-08"');
  });

  it("uses each posted reversal's own journal date in the historical equation", () => {
    const original = postedState();
    const pending = reverseChatTransaction(original, originalId, reversalId);
    const posted = postChatTransaction({ ...pending, messages: approveChatTransaction(pending.messages, reversalId) }, reversalId);
    const entries = posted.ledger.journalEntries.map((entry) => entry.id === reversalId ? { ...entry, date: "2026-10-09" } : entry);
    const ui = reportHarness(createAccountingLedgerState(entries));
    ui.setDate("2026-10-08");
    expect(summaryAmount(ui.html(), "Total assets")).toBe(-700.125);
    expect(earningsAmount(ui.html())).toBe(-700.125);
    ui.setDate("2026-10-09");
    expect(summaryAmount(ui.html(), "Total assets")).toBe(0);
    expect(earningsAmount(ui.html())).toBe(0);
    expect(ui.html()).toContain("2 posted entries included");
  });

  it("retains validated source currency and zero accounts when no entries precede the cutoff", () => {
    const ui = reportHarness(postedState().ledger);
    ui.setDate("2026-10-07");
    const html = ui.html();
    expect(html).toContain("No posted entries on or before this date");
    expect(html).not.toContain("No posted journal entries yet");
    expect(html).toContain(">KWD</span>");
    expect(html).toContain(">0 KWD</dd>");
    expect(html).not.toContain("Not established");
    for (const account of statementAccounts) expect(accountAmount(html, account.code)).toBe(0);
    expect(earningsAmount(html)).toBe(0);
    expect(html).toContain(">Balanced</p>");
    ui.clear();
    expect(ui.html()).not.toContain("No posted entries on or before this date");
    expect(summaryAmount(ui.html(), "Total assets")).toBe(-700.125);
  });

  it("shows the core tolerance status without hiding the actual signed equation difference", () => {
    const entry = capitalEntry({ lines: [{ accountId: "bank", debit: 1, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1 - 0.75e-9 }] });
    const within = createAccountingLedgerState([entry]);
    const outside = createAccountingLedgerState([entry, { ...entry, id: "balance-sheet-ui-second-capital" }]);
    for (const [ledger, balanced] of [[within, true], [outside, false]] as const) {
      const report = getBalanceSheetReport(ledger);
      if (report.status !== "ready") throw new Error(report.message);
      expect(report.balanceSheet.balanced).toBe(balanced);
      expect(report.balanceSheet.difference).toBeGreaterThan(0);
      const html = renderReport(ledger);
      expect(summaryAmount(html, "Difference")).toBeCloseTo(report.balanceSheet.difference, 20);
      expect(summaryAmount(html, "Difference")).not.toBe(0);
      expect(html).toContain(balanced ? ">Balanced</p>" : ">Out of balance</p>");
      expect(html).not.toContain(balanced ? ">Out of balance</p>" : ">Balanced</p>");
    }
  });

  it.each([1e-21, -1e-21])("keeps tiny signed balances and current earnings %s visible without rounding to zero", (amount) => {
    const ledger = createAccountingLedgerState([{ ...revenueEntry(), lines: amount > 0
      ? [{ accountId: "bank", debit: amount, credit: 0 }, { accountId: "revenue", debit: 0, credit: amount }]
      : [{ accountId: "bank", debit: 0, credit: -amount }, { accountId: "revenue", debit: -amount, credit: 0 }],
    }]);
    const html = renderReport(ledger);
    expect(summaryAmount(html, "Total assets")).toBe(amount);
    expect(summaryAmount(html, "Total equity")).toBe(amount);
    expect(accountAmount(html, "1010")).toBe(amount);
    expect(earningsAmount(html)).toBe(amount);
    expect(html).toContain(`>${amount} KWD</dd>`);
  });

  it("shows no financial amounts, equation status, or tables for unavailable, malformed, or invalid-currency data", () => {
    const source = postedState().ledger;
    const malformed = { ...source, journalEntries: [{ ...source.journalEntries[0], lines: [] }] };
    const missingCurrency = { ...source, journalEntries: [{ ...source.journalEntries[0], currency: "" }] };
    const invalidCurrency = { ...source, journalEntries: [{ ...source.journalEntries[0], currency: "UNKNOWN" }] };
    for (const ledger of [null, undefined, malformed, missingCurrency, invalidCurrency]) {
      const html = renderReport(ledger);
      expect(html).toContain('role="alert"');
      expect(html).toContain("Unable to display the Balance Sheet");
      expect(html).not.toContain("<dd");
      expect(html).not.toContain("<table");
      expect(html).not.toContain(">Balanced</p>");
      expect(html).not.toContain(">Out of balance</p>");
    }
  });

  it("does not hide mixed source currencies by excluding a later posting from the cutoff", () => {
    const source = postedState().ledger;
    const mixed = { ...source, journalEntries: [...source.journalEntries, capitalEntry({ date: "2026-10-09", currency: "USD" })] };
    const ui = reportHarness(mixed);
    expect(ui.html()).toContain('role="alert"');
    ui.setDate("2026-10-08");
    expect(ui.html()).toContain('role="alert"');
    expect(ui.html()).not.toContain("<dd");
    expect(ui.html()).not.toContain("<table");
  });

  it.each(["", "2026-02-30"])("warns about unknown source journal date %s and safely rejects historical reporting", (date) => {
    const ui = reportHarness(createAccountingLedgerState([capitalEntry({ date })]));
    expect(summaryAmount(ui.html(), "Total assets")).toBe(1_000);
    expect(ui.html()).toContain("1 posted entry has no valid journal date.");
    expect(ui.html()).toContain('role="status"');
    ui.setDate("2026-10-09");
    expect(ui.html()).toContain('role="alert"');
    expect(ui.html()).not.toContain("<dd");
    expect(ui.html()).not.toContain("<table");
    ui.clear();
    expect(ui.html()).not.toContain('role="alert"');
    expect(summaryAmount(ui.html(), "Total assets")).toBe(1_000);
  });

  it("handles an invalid as-of filter and recovers when cleared", () => {
    const ui = reportHarness(postedState().ledger);
    ui.setDate("2026-02-30");
    expect(ui.html()).toContain('role="alert"');
    expect(ui.html()).not.toContain("<dd");
    ui.clear();
    expect(ui.html()).not.toContain('role="alert"');
    expect(summaryAmount(ui.html(), "Total assets")).toBe(-700.125);
  });

  it("does not mutate a frozen ledger, balances, or reversal reservations when viewed and filtered", () => {
    const original = postedState();
    const pending = reverseChatTransaction(original, originalId, reversalId);
    const ledger = pending.ledger;
    const snapshot = structuredClone(ledger);
    freezeRecursively(ledger);
    const ui = reportHarness(ledger);
    ui.html();
    ui.setDate("2026-10-08");
    ui.html();
    ui.setDate("2026-10-07");
    ui.html();
    ui.clear();
    ui.html();
    expect(ledger).toEqual(snapshot);
    expect(ledger.journalEntries.map(({ id }) => id)).toEqual([originalId]);
  });

  it("reads the shared session ledger on /balance-sheet and marks its sidebar navigation active", () => {
    const chat = postedState();
    vi.mocked(useAccountingSession).mockReturnValue({ chat, setChat: vi.fn(), nextTransactionId: vi.fn() });
    const page = BalanceSheetPage();
    const component = elements(page).find((element) => element.type === BalanceSheetReport) as ReactElement<ComponentProps<typeof BalanceSheetReport>> | undefined;
    expect(component?.props.ledger).toBe(chat.ledger);
    const html = renderToStaticMarkup(page);
    const link = html.match(/<a\b[^>]*href="\/balance-sheet"[^>]*>Balance Sheet<\/a>/)?.[0];
    expect(link).toContain('aria-current="page"');
    expect(html).toContain(">Balance Sheet</h1>");
    expect(accountAmount(html, "1010")).toBe(-700.125);
    expect(earningsAmount(html)).toBe(-700.125);
  });
});
