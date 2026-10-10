import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import GeneralLedger from "@/components/ledger/GeneralLedger";
import GeneralLedgerPage from "@/app/ledger/page";
import LedgerPageClient from "@/components/ledger/LedgerPageClient";
import TrialBalanceReport from "@/components/trial-balance/TrialBalanceReport";
import ProfitLossReport from "@/components/profit-loss/ProfitLossReport";
import BalanceSheetReport from "@/components/balance-sheet/BalanceSheetReport";
import AccountingOverview from "@/components/dashboard/AccountingOverview";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { createAccountingLedgerState } from "@/lib/accounting/transaction-posting";
import type { Account, JournalEntry } from "@/lib/accounting/types";
import type { GeneralLedgerFilters } from "@/lib/general-ledger";
import { getLedgerAccountHref, resolveLedgerQuery } from "@/lib/ledger-navigation";

type HookFrame = { values: unknown[]; cursor: number };
const hooks = vi.hoisted(() => ({ active: null as HookFrame | null }));

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

afterEach(() => { hooks.active = null; });

type NodeProps = {
  children?: ReactNode;
  id?: string;
  href?: string;
  value?: string;
  initialFilters?: GeneralLedgerFilters;
  initialQueryError?: string | null;
  onChange?: (event: { target: { value: string } }) => void;
  onClick?: () => void;
};

function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<NodeProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function harness(render: () => ReactNode) {
  const frame: HookFrame = { values: [], cursor: 0 };
  function renderNode() {
    frame.cursor = 0;
    hooks.active = frame;
    try { return render(); } finally { hooks.active = null; }
  }
  return {
    html: () => renderToStaticMarkup(renderNode()),
    change(id: string, value: string) {
      const control = elements(renderNode()).find((element) => element.props.id === id);
      if (!control?.props.onChange) throw new Error(`Expected filter ${id}.`);
      control.props.onChange({ target: { value } });
    },
    clear() {
      const button = elements(renderNode()).find((element) => element.type === "button" && element.props.children === "Clear filters");
      if (!button?.props.onClick) throw new Error("Expected the Clear filters action.");
      button.props.onClick();
    },
  };
}

function freezeRecursively(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

const entries: JournalEntry[] = [
  { id: "drill-capital", date: "2026-10-01", description: "Capital", currency: "KWD", lines: [
    { accountId: "bank", debit: 1000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1000 },
  ] },
  { id: "drill-sale", date: "2026-10-05", description: "Sale", currency: "KWD", lines: [
    { accountId: "bank", debit: 500, credit: 0 }, { accountId: "revenue", debit: 0, credit: 500 },
  ] },
  { id: "drill-rent", date: "2026-10-09", description: "Rent", currency: "KWD", lines: [
    { accountId: "rent-expense", debit: 200, credit: 0 }, { accountId: "bank", debit: 0, credit: 200 },
  ] },
];

const ledger = createAccountingLedgerState(entries);

function hrefFrom(html: string, label: string): string | undefined {
  const link = html.match(new RegExp(`<a\\b[^>]*href="([^"]+)"[^>]*>(?:<[^>]*>)*${label}(?:<[^>]*>)*</a>`));
  return link?.[1].replaceAll("&amp;", "&");
}

describe("account-level General Ledger drill-down", () => {
  it("builds stable accountId links and validates account query parameters", () => {
    expect(getLedgerAccountHref("bank", { startDate: "2026-10-05", endDate: "2026-10-09" }))
      .toBe("/ledger?accountId=bank&startDate=2026-10-05&endDate=2026-10-09");
    expect(resolveLedgerQuery({ accountId: "bank", startDate: "2026-10-05", endDate: "2026-10-09" }))
      .toEqual({ filters: { accountId: "bank", startDate: "2026-10-05", endDate: "2026-10-09" }, invalidQueryMessage: null });
    expect(resolveLedgerQuery({ accountId: "not-an-account" })).toMatchObject({ filters: {}, invalidQueryMessage: expect.any(String) });
    expect(resolveLedgerQuery({ accountId: ["bank", "cash"] })).toMatchObject({ invalidQueryMessage: expect.any(String) });
  });

  it("routes URL query parameters into the existing General Ledger filter", async () => {
    const route = await GeneralLedgerPage({ searchParams: Promise.resolve({ accountId: "bank", startDate: "2026-10-05", endDate: "2026-10-09" }) });
    const client = elements(route).find((element) => element.type === LedgerPageClient);
    expect(client?.props).toMatchObject({ initialFilters: { accountId: "bank", startDate: "2026-10-05", endDate: "2026-10-09" }, initialQueryError: null });

    const invalidRoute = await GeneralLedgerPage({ searchParams: Promise.resolve({ accountId: "unknown" }) });
    const invalidClient = elements(invalidRoute).find((element) => element.type === LedgerPageClient);
    expect(invalidClient?.props).toMatchObject({ initialFilters: {}, initialQueryError: expect.any(String) });
  });

  it("links Trial Balance, Profit & Loss, and Balance Sheet account rows with their date context", () => {
    const snapshot = structuredClone(ledger);
    freezeRecursively(ledger);

    const trialBalance = harness(() => TrialBalanceReport({ ledger }));
    trialBalance.change("trial-balance-date", "2026-10-05");
    expect(hrefFrom(trialBalance.html(), "Bank")).toBe("/ledger?accountId=bank&endDate=2026-10-05");

    const profitLoss = harness(() => ProfitLossReport({ ledger }));
    profitLoss.change("profit-loss-start-date", "2026-10-05");
    profitLoss.change("profit-loss-end-date", "2026-10-09");
    expect(hrefFrom(profitLoss.html(), "Revenue")).toBe("/ledger?accountId=revenue&startDate=2026-10-05&endDate=2026-10-09");

    const balanceSheet = harness(() => BalanceSheetReport({ ledger }));
    balanceSheet.change("balance-sheet-date", "2026-10-05");
    expect(hrefFrom(balanceSheet.html(), "Bank")).toBe("/ledger?accountId=bank&endDate=2026-10-05");

    expect(ledger).toEqual(snapshot);
  });

  it("links Dashboard Cash and Bank cards only for uniquely classified canonical accounts, without dates", () => {
    const cashLedger = createAccountingLedgerState([{
      id: "drill-cash-sale", date: "2026-10-06", description: "Cash sale", currency: "KWD", lines: [
        { accountId: "cash", debit: 500, credit: 0 }, { accountId: "revenue", debit: 0, credit: 500 },
      ],
    }]);
    const missingBank = DEFAULT_CHART_OF_ACCOUNTS.filter(({ id }) => id !== "bank");
    const missingBankHtml = renderToStaticMarkup(createElement(AccountingOverview, { ledger: cashLedger, accounts: missingBank }));
    expect(missingBankHtml).toContain('href="/ledger?accountId=cash"');
    expect(missingBankHtml).not.toContain('href="/ledger?accountId=bank"');

    const ambiguousCash = [...DEFAULT_CHART_OF_ACCOUNTS, { id: "cash", code: "9999", name: "Duplicate cash", type: "asset" } as Account];
    const ambiguousCashHtml = renderToStaticMarkup(createElement(AccountingOverview, { ledger, accounts: ambiguousCash }));
    expect(ambiguousCashHtml).not.toContain('href="/ledger?accountId=cash"');
    expect(ambiguousCashHtml).toContain('href="/ledger?accountId=bank"');
  });

  it("initializes valid ledger query filters, rejects unknown accounts, and still allows clearing or changing filters", () => {
    const valid = resolveLedgerQuery({ accountId: "bank", startDate: "2026-10-05", endDate: "2026-10-09" });
    const filtered = harness(() => GeneralLedger({ ledger, initialFilters: valid.filters, initialQueryError: valid.invalidQueryMessage }));
    expect(filtered.html()).toContain('<option value="bank" selected="">1010 - Bank</option>');
    expect(filtered.html()).toContain("drill-sale");
    expect(filtered.html()).not.toContain("drill-capital");
    expect(filtered.html()).toContain("drill-rent");

    filtered.change("ledger-account", "rent-expense");
    expect(filtered.html()).toContain("drill-rent");
    expect(filtered.html()).not.toContain("drill-sale");
    filtered.clear();
    expect(filtered.html()).toContain("drill-capital");
    expect(filtered.html()).toContain("drill-sale");
    expect(filtered.html()).toContain("drill-rent");

    const invalid = resolveLedgerQuery({ accountId: "unknown" });
    const rejected = harness(() => GeneralLedger({ ledger, initialFilters: invalid.filters, initialQueryError: invalid.invalidQueryMessage }));
    expect(rejected.html()).toContain("Unable to apply the General Ledger link");
    expect(rejected.html()).not.toContain("drill-capital");
    expect(rejected.html()).not.toContain("drill-sale");
    rejected.clear();
    expect(rejected.html()).toContain("drill-capital");
    rejected.change("ledger-account", "rent-expense");
    expect(rejected.html()).toContain("drill-rent");
    expect(rejected.html()).not.toContain("drill-sale");
  });
});
