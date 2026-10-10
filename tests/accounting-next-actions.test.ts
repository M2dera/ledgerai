import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { createAccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction } from "@/lib/accounting/transaction-workflow";
import type { SuggestedJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import type { JournalEntry } from "@/lib/accounting/types";
import { approveChatTransaction, createChatState, postChatTransaction, reverseChatTransaction } from "@/lib/chat";
import { ACCOUNTING_ACTION_SOURCE, getAccountingNextActions } from "@/lib/analysis/accounting-next-actions";
import AccountingNextActions from "@/components/dashboard/AccountingNextActions";
import ChatWindow from "@/components/chat/ChatWindow";

const rent: JournalEntry = {
  id: "rent-entry", date: "2026-10-08", description: "Rent payment", currency: "KWD",
  lines: [{ accountId: "rent-expense", debit: 600, credit: 0 }, { accountId: "bank", debit: 0, credit: 600 }],
};
const unpaidUtility: JournalEntry = {
  id: "utility-entry", date: "2026-10-09", description: "Unpaid utility bill", currency: "KWD",
  lines: [{ accountId: "utilities-expense", debit: 120, credit: 0 }, { accountId: "accounts-payable", debit: 0, credit: 120 }],
};
const creditSale: JournalEntry = {
  id: "credit-sale", date: "2026-10-09", description: "Credit sale", currency: "KWD",
  lines: [{ accountId: "accounts-receivable", debit: 300, credit: 0 }, { accountId: "revenue", debit: 0, credit: 300 }],
};

function rentSuggestion(): SuggestedJournalEntry {
  return {
    intent: { intentType: "expense_payment", categoryHint: "rent", amount: 600, currency: "KWD", sourceAccountHint: { id: "bank", type: "asset" }, description: "Rent" },
    entry: rent,
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach((child) => deepFreeze(child));
  return Object.freeze(value);
}

describe("deterministic accounting next actions", () => {
  it("shows a neutral empty state when there are no posted entries, even if a suggestion is unposted", () => {
    const unposted = createSuggestedTransaction(rentSuggestion());
    const result = getAccountingNextActions(createAccountingLedgerState(), [unposted]);
    expect(result).toMatchObject({ status: "empty", source: ACCOUNTING_ACTION_SOURCE, message: expect.stringContaining("not enough accounting data"), actions: [] });
  });

  it("suggests reviewing posted payable and receivable balances through their own ledger accounts", () => {
    const result = getAccountingNextActions(createAccountingLedgerState([unpaidUtility, creditSale]));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "accounts-payable-balance", reason: expect.stringContaining("120 KWD"), links: [{ href: "/ledger?accountId=accounts-payable", label: "View Accounts Payable ledger" }] }),
      expect.objectContaining({ id: "accounts-receivable-balance", reason: expect.stringContaining("300 KWD"), links: [{ href: "/ledger?accountId=accounts-receivable", label: "View Accounts Receivable ledger" }] }),
    ]));
  });

  it("uses the validated Trial Balance discrepancy and suggests expense review when expenses exceed revenue", () => {
    const almostBalanced: JournalEntry[] = [0, 1].map((index) => ({
      ...rent, id: `rounding-${index}`,
      lines: [{ accountId: "rent-expense", debit: 1, credit: 0 }, { accountId: "bank", debit: 0, credit: 1 - 0.75e-9 }],
    }));
    const discrepancy = getAccountingNextActions(createAccountingLedgerState(almostBalanced));
    expect(discrepancy.status).toBe("ready");
    if (discrepancy.status === "ready") expect(discrepancy.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "trial-balance-discrepancy", links: [{ href: "/trial-balance", label: "Review Trial Balance" }] }),
    ]));

    const loss = getAccountingNextActions(createAccountingLedgerState([rent]));
    expect(loss.status).toBe("ready");
    if (loss.status === "ready") expect(loss.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "expenses-exceed-revenue", reason: expect.stringContaining("600 KWD"), links: [{ href: "/profit-loss", label: "Review Profit & Loss" }] }),
    ]));
  });

  it("links a posted reversal to both session entries only when references and posted transaction states agree", () => {
    const suggestion = createSuggestedTransaction(rentSuggestion());
    const original = createChatState([{ sender: "ai", text: "Rent", transaction: suggestion }]);
    const postedOriginal = postChatTransaction({ ...original, messages: approveChatTransaction(original.messages, rent.id) }, rent.id);
    const pending = reverseChatTransaction(postedOriginal, rent.id, "reverse-rent");
    const withPending = getAccountingNextActions(pending.ledger, pending.messages.flatMap((message) => message.sender === "ai" && message.transaction ? [message.transaction] : []));
    expect(withPending.status).toBe("ready");
    if (withPending.status === "ready") expect(withPending.actions.some(({ id }) => id.startsWith("posted-reversal-"))).toBe(false);

    const postedReversal = postChatTransaction({ ...pending, messages: approveChatTransaction(pending.messages, "reverse-rent") }, "reverse-rent");
    const transactions = postedReversal.messages.flatMap((message) => message.sender === "ai" && message.transaction ? [message.transaction] : []);
    const result = getAccountingNextActions(postedReversal.ledger, transactions);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "posted-reversal-reverse-rent",
        links: [
          { href: "/chat#transaction-rent-entry", label: "View original entry rent-entry" },
          { href: "/chat#transaction-reverse-rent", label: "View reversal entry reverse-rent" },
        ],
      }),
    ]));
    const inconsistentTransactions = transactions.map((transaction) => transaction.suggestion.entry.id === rent.id
      ? { ...transaction, suggestion: { ...transaction.suggestion, entry: { ...transaction.suggestion.entry, description: "A different entry" } } }
      : transaction);
    const inconsistent = getAccountingNextActions(postedReversal.ledger, inconsistentTransactions);
    expect(inconsistent.status).toBe("ready");
    if (inconsistent.status === "ready") expect(inconsistent.actions.some(({ id }) => id.startsWith("posted-reversal-"))).toBe(false);
    const html = renderToStaticMarkup(createElement(ChatWindow, { messages: postedReversal.messages }));
    expect(html).toContain('id="transaction-rent-entry"');
    expect(html).toContain('id="transaction-reverse-rent"');
  });

  it("returns no partial suggestions for malformed or mixed-currency posted data", () => {
    expect(getAccountingNextActions({ journalEntries: [{ ...rent, currency: "USD" }, rent], reversalReferences: [] })).toMatchObject({ status: "error", actions: [] });
    expect(getAccountingNextActions({ journalEntries: [{ ...rent, lines: [{ accountId: "missing", debit: 600, credit: 0 }] }], reversalReferences: [] } as never)).toMatchObject({ status: "error", actions: [] });
  });

  it("does not assume a canonical account when its Chart of Accounts identity is ambiguous", () => {
    const accounts = [...DEFAULT_CHART_OF_ACCOUNTS, { id: "accounts-payable", code: "2999", name: "Duplicate", type: "liability" as const }];
    const result = getAccountingNextActions(createAccountingLedgerState([unpaidUtility]), [], accounts);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.actions.some(({ id }) => id === "accounts-payable-balance")).toBe(false);
  });

  it("labels its source distinctly from workbook analysis and does not mutate session accounting state", () => {
    const ledger = createAccountingLedgerState([rent]);
    const transaction = createSuggestedTransaction(rentSuggestion());
    const snapshot = structuredClone({ ledger, transactions: [transaction] });
    const frozenLedger = deepFreeze(ledger);
    const frozenTransactions = deepFreeze([transaction]);
    const result = getAccountingNextActions(frozenLedger, frozenTransactions);
    const html = renderToStaticMarkup(createElement(AccountingNextActions, { ledger: frozenLedger, transactions: frozenTransactions }));
    expect(result.source).toBe("Posted accounting entries in this session");
    expect(html).toContain("Source: Posted accounting entries in this session");
    expect(html).not.toContain("Uploaded spreadsheet");
    expect({ ledger, transactions: [transaction] }).toEqual(snapshot);
  });
});
