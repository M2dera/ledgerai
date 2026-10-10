import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeData } from "@/lib/analysis/analyzer";
import { answerAccountingQuestion, classifyAccountingQuestion } from "@/lib/analysis/accounting-question";
import { createAccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import type { JournalEntry } from "@/lib/accounting/types";
import { routeChatMessage } from "@/lib/chat";
import { createSuggestedTransaction } from "@/lib/accounting/transaction-workflow";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { getBalanceSheetReport } from "@/lib/balance-sheet";
import { getProfitLossReport } from "@/lib/profit-loss";
import { getTrialBalanceReport } from "@/lib/trial-balance";

const entries: JournalEntry[] = [
  { id: "capital", date: "2026-10-01", description: "Owner investment", currency: "KWD", lines: [
    { accountId: "bank", debit: 10000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 10000 },
  ] },
  { id: "sale", date: "2026-10-05", description: "Service revenue", currency: "KWD", lines: [
    { accountId: "bank", debit: 2000, credit: 0 }, { accountId: "revenue", debit: 0, credit: 2000 },
  ] },
  { id: "rent", date: "2026-10-08", description: "Rent", currency: "KWD", lines: [
    { accountId: "rent-expense", debit: 600.125, credit: 0 }, { accountId: "bank", debit: 0, credit: 600.125 },
  ] },
  { id: "utilities", date: "2026-10-10", description: "Utilities", currency: "KWD", lines: [
    { accountId: "utilities-expense", debit: 100, credit: 0 }, { accountId: "accounts-payable", debit: 0, credit: 100 },
  ] },
];

const ledger = createAccountingLedgerState(entries);
const chatOptions = { id: () => "should-not-be-consumed", date: "2026-10-10", accountingLedger: ledger };

const workbook = analyzeData({
  columns: ["Revenue", "Expenses", "Category"],
  rows: [{ Revenue: 900, Expenses: 300, Category: "Rent" }],
  warnings: [], errors: [],
}, { id: "workbook-source", name: "workbook.csv", size: 1, type: "text/csv", uploadedAt: "2026-10-10T00:00:00.000Z" });

afterEach(() => vi.restoreAllMocks());

function textFor(result: Awaited<ReturnType<typeof routeChatMessage>>) {
  if (result.route === "transaction") throw new Error("Expected a question response.");
  return result.route === "analyst" ? result.interpretation.interpretation : result.text;
}

describe("posted accounting question routing", () => {
  it.each([
    ["How much revenue from posted entries?", "revenue", "2,000 KWD"],
    ["What are expenses from posted entries?", "expenses", "700.125 KWD"],
    ["What is net profit or loss from the posted ledger?", "net_income", "1,299.875 KWD"],
    ["What is the bank balance?", "account_balance", "11,399.875 KWD"],
    ["What is the largest expense in the posted ledger?", "largest_expense", "Rent Expense, 600.125 KWD"],
    ["What are total assets from the Balance Sheet?", "total_assets", "11,399.875 KWD"],
    ["What are total liabilities from the Balance Sheet?", "total_liabilities", "100 KWD"],
    ["What are total equity from the Balance Sheet?", "total_equity", "11,299.875 KWD"],
    ["What are assets, liabilities, and equity from the Balance Sheet?", "balance_sheet_totals", "assets 11,399.875 KWD, liabilities 100 KWD, and equity including current earnings 11,299.875 KWD"],
    ["Is the trial balance balanced?", "trial_balance_status", "Trial Balance as of the current posted ledger: Balanced"],
  ] as const)("answers supported English question: %s", async (question, intent, expected) => {
    expect(classifyAccountingQuestion(question)).toBe(intent);
    const result = await routeChatMessage(question, null, vi.fn(), chatOptions);
    expect(result).toMatchObject({ route: "local", intent: "accounting_ledger" });
    expect(textFor(result)).toContain(expected);
    expect(textFor(result)).toContain("Source: Posted accounting entries in this session.");
  });

  it.each([
    ["\u0643\u0645 \u0627\u0644\u0625\u064A\u0631\u0627\u062F\u0627\u062A \u0645\u0646 \u0627\u0644\u0642\u064A\u0648\u062F \u0627\u0644\u0645\u0631\u062D\u0644\u0629\u061F", "revenue", "2,000 KWD"],
    ["\u0634\u0646\u0648 \u0623\u0643\u062B\u0631 \u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641 \u0641\u064A \u062F\u0641\u062A\u0631 \u0627\u0644\u0623\u0633\u062A\u0627\u0630\u061F", "largest_expense", "Rent Expense, 600.125 KWD"],
    ["\u0643\u0645 \u0635\u0627\u0641\u064A \u0627\u0644\u0631\u0628\u062D \u062D\u0633\u0628 \u0627\u0644\u0642\u064A\u0648\u062F \u0627\u0644\u0645\u062D\u0627\u0633\u0628\u064A\u0629\u061F", "net_income", "1,299.875 KWD"],
    ["\u0643\u0645 \u0631\u0635\u064A\u062F \u0627\u0644\u0628\u0646\u0643\u061F", "account_balance", "11,399.875 KWD"],
  ] as const)("answers supported Arabic question", (question, intent, expected) => {
    expect(classifyAccountingQuestion(question)).toBe(intent);
    const result = answerAccountingQuestion(question, ledger)!;
    expect(result.intent).toBe(intent);
    expect(result.text).toContain(expected);
    expect(result.text).toContain("Source: Posted accounting entries in this session.");
  });

  it("routes inclusive as-of cutoffs by journal date", () => {
    const revenue = answerAccountingQuestion("Revenue from posted entries as of 2026-10-05", ledger)!;
    const bank = answerAccountingQuestion("What is the bank balance as of 2026-10-05?", ledger)!;
    expect(revenue.text).toContain("2,000 KWD");
    expect(bank.text).toContain("12,000 KWD");
    expect(answerAccountingQuestion("Revenue from posted entries as of 2026-10-04", ledger)?.text).toContain("0 KWD");
    expect(answerAccountingQuestion("What are total assets from the Balance Sheet as of 2026-10-05?", ledger)?.text).toContain("12,000 KWD");
    expect(answerAccountingQuestion("Revenue from posted entries as of 2026-02-30", ledger)?.text).toContain("valid date");
    expect(answerAccountingQuestion("Revenue from posted entries until tomorrow", ledger)?.text).toContain("YYYY-MM-DD");
    expect(answerAccountingQuestion("\u0643\u0645 \u0631\u0635\u064A\u062F \u0627\u0644\u0628\u0646\u0643 \u062D\u062A\u0649 \u062A\u0627\u0631\u064A\u062E 2026-10-05\u061F", ledger)?.text).toContain("12,000 KWD");
  });

  it("matches Trial Balance and Balance Sheet responses to existing report functions", () => {
    const trial = getTrialBalanceReport(ledger);
    const balanceSheet = getBalanceSheetReport(ledger);
    const trialAnswer = answerAccountingQuestion("Is the trial balance balanced?", ledger)!;
    const balanceAnswer = answerAccountingQuestion("What are total assets, liabilities, and equity from the Balance Sheet?", ledger)!;
    expect(trial.status).toBe("ready");
    expect(balanceSheet.status).toBe("ready");
    if (trial.status === "ready" && balanceSheet.status === "ready") {
      expect(trialAnswer.text).toContain(trial.trialBalance.balanced ? "Balanced" : "Out of balance");
      expect(balanceAnswer.text).toContain(`${balanceSheet.balanceSheet.totalAssets.toLocaleString(undefined, { maximumFractionDigits: 3 })} KWD`);
      expect(balanceAnswer.text).toContain(`${balanceSheet.balanceSheet.totalLiabilities.toLocaleString(undefined, { maximumFractionDigits: 3 })} KWD`);
      expect(balanceAnswer.text).toContain(`${balanceSheet.balanceSheet.totalEquity.toLocaleString(undefined, { maximumFractionDigits: 3 })} KWD`);
    }
    expect(getProfitLossReport(ledger).status).toBe("ready");
  });

  it("offsets posted reversals while excluding draft and unposted transactions", () => {
    const reversedRent: JournalEntry = {
      ...entries[2], id: "rent-reversal", description: "Posted reversal of rent", date: "2026-10-09",
      lines: entries[2].lines.map((line) => ({ accountId: line.accountId, debit: line.credit, credit: line.debit })),
    };
    const afterReversal = createAccountingLedgerState([...entries, reversedRent]);
    expect(answerAccountingQuestion("What are expenses from posted entries?", afterReversal)?.text).toContain("100 KWD");
    const parsed = parseTransactionIntent("paid rent 900 KWD from cash");
    if (parsed.status !== "resolved") throw new Error("Expected the unposted fixture intent.");
    const suggestion = suggestJournalEntry(parsed.intent, { id: "pending-rent", date: "2026-10-11" });
    if (suggestion.status !== "suggested") throw new Error("Expected a validated unposted suggestion.");
    const pending = createSuggestedTransaction(suggestion.suggestion);
    const session = { ledger, messages: [{ sender: "ai" as const, text: "Pending", transaction: pending }] };
    expect(answerAccountingQuestion("What is net profit from the posted ledger?", session.ledger)?.text).toContain("1,299.875 KWD");
    expect(session.messages[0].transaction.status).toBe("awaiting_approval");
  });

  it("asks clarification for ambiguous accounts, unsupported ledger questions, and unsupported report requests", () => {
    expect(answerAccountingQuestion("What is the bank and cash balance?", ledger)?.text).toContain("ambiguous");
    expect(answerAccountingQuestion("What is the cash balance?", ledger)?.text).toContain("Cash balance as of the current posted ledger: 0 KWD");
    expect(answerAccountingQuestion("What is the account balance?", ledger)?.text).toContain("Which account balance");
    expect(answerAccountingQuestion("What is EBITDA in the posted ledger?", ledger)?.text).toContain("I can answer posted-ledger questions");
    expect(answerAccountingQuestion("What is the Balance Sheet?", ledger)?.text).toContain("Specify whether");
    expect(answerAccountingQuestion("What is the Trial Balance?", ledger)?.text).toContain("Ask whether");
    expect(answerAccountingQuestion("What are revenue and expenses from the posted ledger?", ledger)?.text).toContain("one Profit & Loss measure at a time");
    const duplicateNameAccounts = [...DEFAULT_CHART_OF_ACCOUNTS, { id: "secondary-bank", code: "1011", name: "Bank", type: "asset" as const }];
    expect(answerAccountingQuestion("What is the Bank balance?", ledger, duplicateNameAccounts)?.text).toContain("ambiguous");
  });

  it("does not switch to workbook data for ledger-specific questions and preserves workbook routing for generic questions", async () => {
    const analyst = vi.fn();
    const ledgerSpecific = await routeChatMessage("What is revenue from posted entries?", workbook, analyst, chatOptions);
    const generic = await routeChatMessage("What is revenue?", workbook, analyst, chatOptions);
    expect(textFor(ledgerSpecific)).toContain("2,000 KWD");
    expect(textFor(ledgerSpecific)).not.toContain("900");
    expect(textFor(generic)).toContain("900");
    expect(textFor(generic)).toContain("analyzed revenue");
    expect(analyst).not.toHaveBeenCalled();
  });

  it("safely reports empty, mixed-currency, malformed, and undated cutoff sources", () => {
    expect(answerAccountingQuestion("Revenue from posted entries", createAccountingLedgerState([]))?.text).toContain("There are no posted accounting entries");
    const mixed = { journalEntries: [...entries, { ...entries[0], id: "usd-entry", currency: "USD" }] };
    expect(answerAccountingQuestion("Revenue from posted entries", mixed)?.text).toContain("Unable to safely read");
    const invalidCurrency = { journalEntries: [{ ...entries[0], currency: "KWD1" }] };
    expect(answerAccountingQuestion("Revenue from posted entries", invalidCurrency)?.text).toContain("Unable to safely read");
    const malformed = { journalEntries: [{ ...entries[0], lines: [{ accountId: "unknown", debit: 1, credit: 0 }, { accountId: "bank", debit: 0, credit: 1 }] }] };
    expect(answerAccountingQuestion("Revenue from posted entries", malformed)?.text).toContain("Unable to safely read");
    const undated = { journalEntries: [{ ...entries[0], date: "invalid-date" }] };
    expect(answerAccountingQuestion("Revenue from posted entries as of 2026-10-10", undated)?.text).toContain("missing or invalid journal date");
  });

  it("does not mutate posted entries or consume a transaction ID for accounting Q&A", async () => {
    const snapshot = structuredClone(ledger);
    const entriesReference = ledger.journalEntries;
    const id = vi.fn(() => "must-not-run");
    const result = await routeChatMessage("What is the bank balance?", workbook, vi.fn(), { ...chatOptions, id });
    expect(textFor(result)).toContain("11,399.875 KWD");
    expect(id).not.toHaveBeenCalled();
    expect(ledger).toEqual(snapshot);
    expect(ledger.journalEntries).toBe(entriesReference);
  });
});
