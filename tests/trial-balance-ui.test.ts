import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrialBalancePage from "@/app/trial-balance/page";
import TrialBalanceReport from "@/components/trial-balance/TrialBalanceReport";
import { useAccountingSession } from "@/components/providers/AccountingSessionProvider";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { calculateLedgerTotals, createTrialBalance } from "@/lib/accounting/ledger";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { createAccountingLedgerState, type AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import type { JournalEntry } from "@/lib/accounting/types";
import { approveChatTransaction, createChatState, postChatTransaction, reverseChatTransaction, type ChatState } from "@/lib/chat";

type HookFrame = { values: unknown[]; cursor: number };
const hooks = vi.hoisted(() => ({ active: null as HookFrame | null }));

// Native date callbacks use the existing lightweight hook harness; static
// renders still use React's own hooks without introducing a DOM dependency.
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
vi.mock("next/navigation", () => ({ usePathname: () => "/trial-balance" }));
vi.mock("@/components/providers/AccountingSessionProvider", () => ({ useAccountingSession: vi.fn() }));

afterEach(() => {
  hooks.active = null;
  vi.restoreAllMocks();
});

const originalId = "trial-balance-ui-rent";
const reversalId = "trial-balance-ui-reversal";
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

function renderReport(ledger: AccountingLedgerState | null | undefined): string {
  return renderToStaticMarkup(createElement(TrialBalanceReport, { ledger }));
}

function reportHarness(ledger: AccountingLedgerState) {
  const frame: HookFrame = { values: [], cursor: 0 };
  function render() {
    frame.cursor = 0;
    hooks.active = frame;
    try { return TrialBalanceReport({ ledger }); } finally { hooks.active = null; }
  }
  return {
    render,
    html: () => renderToStaticMarkup(render()),
    setDate(value: string) {
      const callback = elements(render()).find((element) => element.props.id === "trial-balance-date")?.props.onChange;
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

function capitalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "trial-balance-capital", date: "2026-10-01", description: "Owner contribution", currency: "KWD",
    lines: [{ accountId: "bank", debit: 1_000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1_000 }],
    ...overrides,
  };
}

function tableRows(html: string): string[] {
  const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  if (!body) throw new Error("Expected account balances table.");
  return body.match(/<tr\b[\s\S]*?<\/tr>/g) ?? [];
}

function amountNumber(text: string): number {
  return Number(text.replace(/ KWD$/, "").replace(/,/g, ""));
}

function accountAmounts(html: string, code: string): number[] {
  const row = tableRows(html).find((candidate) => candidate.includes(`>${code}</td>`));
  if (!row) throw new Error(`Expected account ${code}.`);
  return [...row.matchAll(/<td\b[^>]*>(.*?)<\/td>/g)].slice(-2).map((match) => amountNumber(match[1]));
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

describe("Trial Balance UI", () => {
  it("renders every core account balance, type, and total with accessible headings and currency", () => {
    const entries = [capitalEntry(), ...postedState().ledger.journalEntries];
    const ledger = createAccountingLedgerState(entries);
    const trialBalance = createTrialBalance(entries, DEFAULT_CHART_OF_ACCOUNTS);
    const html = renderReport(ledger);

    expect(tableRows(html)).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    for (const line of trialBalance.lines) {
      expect(accountAmounts(html, line.account.code)).toEqual([line.debitBalance, line.creditBalance]);
    }
    expect(summaryAmount(html, "Total debit balances")).toBe(trialBalance.totalDebits);
    expect(summaryAmount(html, "Total credit balances")).toBe(trialBalance.totalCredits);
    expect(summaryAmount(html, "Difference")).toBe(trialBalance.difference);
    expect(html).toContain(">Balanced</p>");
    expect(html).not.toContain("Out of balance");
    expect(html).toContain(">KWD</span>");
    expect(html).toContain(">299.875 KWD</td>");
    expect(html).toContain(">700.125 KWD</td>");
    expect(html).toContain(">Asset</td>");
    expect(html).toContain(">Equity</td>");
    expect(html).toContain(">Expense</td>");
    expect(html).toContain(">Debit balance</th>");
    expect(html).toContain(">Credit balance</th>");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("<caption");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="region"');
    // Net balances are different from the gross debit/credit journal totals.
    expect(summaryAmount(html, "Total debit balances")).not.toBe(calculateLedgerTotals(entries, DEFAULT_CHART_OF_ACCOUNTS).debitTotal);
  });

  it.each(["draft", "awaiting_approval", "approved"] as const)("excludes %s suggestions while showing an honest zero-account empty state", (status) => {
    const html = renderReport(stateFor(status).ledger);
    expect(html).toContain("No posted journal entries yet");
    expect(html).toContain("approve it, then post it");
    expect(html).toContain('href="/chat"');
    expect(html).toContain("cleared on page refresh");
    expect(html).toContain("Not established");
    expect(html).toContain("0 posted entries included");
    expect(tableRows(html)).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) expect(accountAmounts(html, account.code)).toEqual([0, 0]);
    expect(summaryAmount(html, "Difference")).toBe(0);
  });

  it("includes only actual posted balances and offsets the original only after reversal posting", () => {
    const original = postedState();
    const pending = reverseChatTransaction(original, originalId, reversalId);
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, reversalId) };
    for (const state of [original, pending, approved]) {
      const html = renderReport(state.ledger);
      expect(accountAmounts(html, "1010")).toEqual([0, 700.125]);
      expect(accountAmounts(html, "5000")).toEqual([700.125, 0]);
      expect(html).toContain("1 posted entry included");
    }

    const posted = postChatTransaction(approved, reversalId);
    const html = renderReport(posted.ledger);
    expect(html).toContain("2 posted entries included");
    expect(accountAmounts(html, "1010")).toEqual([0, 0]);
    expect(accountAmounts(html, "5000")).toEqual([0, 0]);
    expect(summaryAmount(html, "Total debit balances")).toBe(0);
    expect(summaryAmount(html, "Total credit balances")).toBe(0);
    expect(posted.ledger.journalEntries.map(({ id }) => id)).toEqual([originalId, reversalId]);
  });

  it("computes an inclusive cumulative As of report and restores all entries when cleared", () => {
    const ledger = createAccountingLedgerState([capitalEntry(), ...postedState().ledger.journalEntries]);
    const ui = reportHarness(ledger);
    ui.setDate("2026-10-01");
    const cutoff = ui.html();
    expect(cutoff).toContain("As of 2026-10-01");
    expect(cutoff).toContain("1 posted entry included through this date, inclusive");
    expect(accountAmounts(cutoff, "1010")).toEqual([1_000, 0]);
    expect(accountAmounts(cutoff, "5000")).toEqual([0, 0]);
    expect(cutoff).toContain('for="trial-balance-date"');
    expect(cutoff).toContain('type="date"');
    expect(cutoff).toContain('aria-describedby="trial-balance-date-help"');

    ui.setDate("2026-10-08");
    expect(accountAmounts(ui.html(), "1010")).toEqual([299.875, 0]);
    expect(accountAmounts(ui.html(), "5000")).toEqual([700.125, 0]);
    expect(ui.html()).toContain("2 posted entries included through this date, inclusive");
    ui.clear();
    expect(ui.html()).toContain("All posted entries");
    expect(ui.html()).toContain("2 posted entries included");
    expect(ui.html()).not.toContain('value="2026-10-08"');
  });

  it("uses each posted reversal's own date for cumulative reporting", () => {
    const original = postedState();
    const pending = reverseChatTransaction(original, originalId, reversalId);
    const approved = { ...pending, messages: approveChatTransaction(pending.messages, reversalId) };
    const posted = postChatTransaction(approved, reversalId);
    const entries = posted.ledger.journalEntries.map((entry) => entry.id === reversalId ? { ...entry, date: "2026-10-09" } : entry);
    const ui = reportHarness(createAccountingLedgerState(entries));
    ui.setDate("2026-10-08");
    expect(accountAmounts(ui.html(), "5000")).toEqual([700.125, 0]);
    ui.setDate("2026-10-09");
    expect(accountAmounts(ui.html(), "5000")).toEqual([0, 0]);
    expect(ui.html()).toContain("2 posted entries included");
  });

  it("distinguishes an empty cutoff from an empty ledger and keeps source currency on zero balances", () => {
    const ui = reportHarness(postedState().ledger);
    ui.setDate("2026-10-07");
    const html = ui.html();
    expect(html).toContain("No posted entries on or before this date");
    expect(html).not.toContain("No posted journal entries yet");
    expect(html).toContain(">KWD</span>");
    expect(html).toContain(">0 KWD</dd>");
    expect(html).not.toContain("Not established");
    expect(tableRows(html)).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    ui.clear();
    expect(ui.html()).not.toContain("No posted entries on or before this date");
    expect(accountAmounts(ui.html(), "5000")).toEqual([700.125, 0]);
  });

  it("shows the core out-of-balance status and keeps a small real difference visibly nonzero", () => {
    const entries = [capitalEntry({
      lines: [
        { accountId: "bank", debit: 2e-9, credit: 0 },
        { accountId: "owners-equity", debit: 0, credit: 1e-9 },
        { accountId: "revenue", debit: 0, credit: 1e-9 },
      ],
    })];
    // Gross journals balance exactly; the core's per-account threshold yields
    // different trial totals. The UI must trust the actual core report.
    const ledger = createAccountingLedgerState(entries);
    const trialBalance = createTrialBalance(entries, DEFAULT_CHART_OF_ACCOUNTS);
    const gross = calculateLedgerTotals(entries, DEFAULT_CHART_OF_ACCOUNTS);
    expect(gross.debitTotal).toBe(gross.creditTotal);
    expect(trialBalance.balanced).toBe(false);
    expect(trialBalance.difference).toBeGreaterThan(1e-9);
    const html = renderReport(ledger);
    expect(html).toContain(">Out of balance</p>");
    expect(html).not.toContain(">Balanced</p>");
    expect(summaryAmount(html, "Difference")).not.toBe(0);
    expect(summaryAmount(html, "Difference")).toBeCloseTo(trialBalance.difference, 20);
    expect(summaryAmount(html, "Total debit balances")).toBe(trialBalance.totalDebits);
    expect(summaryAmount(html, "Total credit balances")).toBe(trialBalance.totalCredits);
  });

  it("uses the core Balanced status for a visibly nonzero difference within accounting tolerance", () => {
    const ledger = createAccountingLedgerState([capitalEntry({
      lines: [{ accountId: "bank", debit: 1, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1 - 0.75e-9 }],
    })]);
    const trialBalance = createTrialBalance(ledger.journalEntries, DEFAULT_CHART_OF_ACCOUNTS);
    expect(trialBalance.balanced).toBe(true);
    expect(trialBalance.difference).toBeGreaterThan(0);
    const html = renderReport(ledger);
    expect(html).toContain(">Balanced</p>");
    expect(html).not.toContain(">Out of balance</p>");
    expect(summaryAmount(html, "Difference")).toBeCloseTo(trialBalance.difference, 20);
    expect(summaryAmount(html, "Difference")).not.toBe(0);
    expect(html).toContain("Balanced allows a difference of up to 0.000000001");
  });

  it("shows no numeric report or balance status for unavailable, malformed, or mixed-currency data", () => {
    const source = postedState().ledger;
    const mixed = { ...source, journalEntries: [...source.journalEntries, capitalEntry({ currency: "USD" })] };
    const malformed = { ...source, journalEntries: [{ ...source.journalEntries[0], lines: [] }] };
    for (const ledger of [null, undefined, mixed, malformed]) {
      const html = renderReport(ledger);
      expect(html).toContain('role="alert"');
      expect(html).toContain("Unable to display the Trial Balance");
      expect(html).not.toContain("<dd");
      expect(html).not.toContain("<table");
      expect(html).not.toContain(">Balanced</p>");
      expect(html).not.toContain(">Out of balance</p>");
    }
  });

  it("rejects unknown source dates for a historical report and recovers to the all-entry report", () => {
    const ui = reportHarness(createAccountingLedgerState([capitalEntry({ date: "2026-02-30" })]));
    expect(accountAmounts(ui.html(), "1010")).toEqual([1_000, 0]);
    ui.setDate("2026-10-09");
    expect(ui.html()).toContain('role="alert"');
    expect(ui.html()).not.toContain("<dd");
    expect(ui.html()).not.toContain("<table");
    ui.clear();
    expect(ui.html()).not.toContain('role="alert"');
    expect(accountAmounts(ui.html(), "1010")).toEqual([1_000, 0]);
  });

  it("handles an invalid As of date safely and allows clearing it", () => {
    const ui = reportHarness(postedState().ledger);
    ui.setDate("2026-02-30");
    expect(ui.html()).toContain('role="alert"');
    expect(ui.html()).not.toContain("<dd");
    ui.clear();
    expect(accountAmounts(ui.html(), "5000")).toEqual([700.125, 0]);
  });

  it("does not mutate a frozen ledger when viewed, filtered, or cleared", () => {
    const ledger = createAccountingLedgerState([capitalEntry(), ...postedState().ledger.journalEntries]);
    const snapshot = structuredClone(ledger);
    freezeRecursively(ledger);
    const ui = reportHarness(ledger);
    ui.html();
    ui.setDate("2026-10-01");
    ui.html();
    ui.clear();
    ui.html();
    expect(ledger).toEqual(snapshot);
    expect(ledger.journalEntries.map(({ id }) => id)).toEqual(["trial-balance-capital", originalId]);
  });

  it("reads the shared ledger on /trial-balance and marks its navigation item active", () => {
    const chat = postedState();
    vi.mocked(useAccountingSession).mockReturnValue({ chat, setChat: vi.fn(), nextTransactionId: vi.fn() });
    const page = TrialBalancePage();
    const component = elements(page).find((element) => element.type === TrialBalanceReport) as ReactElement<ComponentProps<typeof TrialBalanceReport>> | undefined;
    expect(component?.props.ledger).toBe(chat.ledger);
    const html = renderToStaticMarkup(page);
    const trialBalanceLink = html.match(/<a\b[^>]*href="\/trial-balance"[^>]*>Trial Balance<\/a>/)?.[0];
    expect(trialBalanceLink).toContain('aria-current="page"');
    expect(html).toContain(">Trial Balance</h1>");
    expect(accountAmounts(html, "5000")).toEqual([700.125, 0]);
  });
});
