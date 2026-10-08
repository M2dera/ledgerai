import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS, InvalidJournalEntryError, mapFinancialDatasetToAccounting } from "@/lib/accounting";
import type { SuggestedJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import {
  createDraftTransaction,
  createSuggestedTransaction,
  transitionJournalTransaction,
  type JournalTransaction,
  type JournalTransactionStatus,
} from "@/lib/accounting/transaction-workflow";
import * as accountingValidation from "@/lib/accounting/validation";
import * as ledger from "@/lib/accounting/ledger";
import { analyzeData, createUploadedFile } from "@/lib/analysis/analyzer";
import { routeFinancialQuestion } from "@/lib/analysis/chat";
import { approveChatTransaction, routeChatMessage, type ChatMessage } from "@/lib/chat";
import { readExcel } from "@/lib/excel/reader";
import type { FinancialDataset } from "@/lib/financial/types";
import * as financialStore from "@/lib/store/financialStore";

const metadata = { id: "approval-entry-1", date: "2026-10-08" };
const rentMessage = "دفعت إيجار 600 د.ك من البنك";
let dataset: FinancialDataset;

beforeAll(async () => {
  const bytes = await readFile("test-data/LedgerAI_test_financial_data.xlsx");
  const file = new File([bytes], "LedgerAI_test_financial_data.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  dataset = analyzeData(await readExcel(file), createUploadedFile(file));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function freezeRecursively(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  Object.values(value).forEach(freezeRecursively);
  Object.freeze(value);
}

async function getSuggestion(id = metadata.id): Promise<SuggestedJournalEntry> {
  const result = await routeChatMessage(rentMessage, null, vi.fn(), { ...metadata, id });
  if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected a validated accounting suggestion.");
  return result.suggestion;
}

function messageFor(transaction: JournalTransaction): ChatMessage {
  return { sender: "ai", text: "Accounting suggestion", transaction };
}

describe("journal transaction approval workflow", () => {
  it("places existing validated suggestions into awaiting_approval", async () => {
    const suggestion = await getSuggestion();
    const transaction = createSuggestedTransaction(suggestion);

    expect(transaction.status).toBe("awaiting_approval");
    expect(transaction.suggestion).toBe(suggestion);
    expect(transaction).not.toHaveProperty("posted");
  });

  it("supports draft, review, and explicit approval without changing journal evidence", async () => {
    const suggestion = await getSuggestion();
    freezeRecursively(suggestion);
    const snapshot = JSON.stringify(suggestion);
    const validator = vi.spyOn(accountingValidation, "assertValidJournalEntry");
    const draft = createDraftTransaction(suggestion);
    const review = transitionJournalTransaction(draft, "awaiting_approval");
    const approved = transitionJournalTransaction(review, "approved");

    expect(draft.status).toBe("draft");
    expect(review.status).toBe("awaiting_approval");
    expect(approved.status).toBe("approved");
    expect(review).not.toBe(draft);
    expect(approved).not.toBe(review);
    expect(approved.suggestion).toBe(suggestion);
    expect(approved.suggestion.entry).toBe(suggestion.entry);
    expect(approved.suggestion.entry.lines).toBe(suggestion.entry.lines);
    expect(approved.suggestion.entry).toEqual({
      ...metadata, description: rentMessage, currency: "KWD",
      lines: [
        { accountId: "rent-expense", debit: 600, credit: 0 },
        { accountId: "bank", debit: 0, credit: 600 },
      ],
    });
    expect(JSON.stringify(suggestion)).toBe(snapshot);
    expect(validator).toHaveBeenCalledTimes(2);
    expect(validator).toHaveBeenCalledWith(suggestion.entry, DEFAULT_CHART_OF_ACCOUNTS);
  });

  it.each([
    ["draft", "draft"],
    ["draft", "approved"],
    ["awaiting_approval", "draft"],
    ["awaiting_approval", "awaiting_approval"],
    ["approved", "draft"],
    ["approved", "awaiting_approval"],
    ["approved", "approved"],
  ] as const)("rejects the invalid transition %s → %s", async (status, nextStatus) => {
    const transaction: JournalTransaction = { status, suggestion: await getSuggestion() };
    freezeRecursively(transaction);

    expect(() => transitionJournalTransaction(transaction, nextStatus)).toThrow(Error);
    expect(transaction.status).toBe(status);
  });

  it("rejects runtime states outside the defined workflow", async () => {
    const transaction = createSuggestedTransaction(await getSuggestion());

    expect(() => transitionJournalTransaction(transaction, "posted" as JournalTransactionStatus)).toThrow(Error);
    expect(() => transitionJournalTransaction({ ...transaction, status: "posted" as JournalTransactionStatus }, "approved")).toThrow(Error);
    expect(transaction.status).toBe("awaiting_approval");
  });

  it.each(["draft", "awaiting_approval"] as const)("uses Accounting Core to reject invalid entry data from %s", async (status) => {
    const suggestion = await getSuggestion();
    const invalidSuggestion = {
      ...suggestion,
      entry: { ...suggestion.entry, lines: [
        { accountId: "rent-expense", debit: 600, credit: 0 },
        { accountId: "bank", debit: 0, credit: 599 },
      ] },
    };
    const transaction: JournalTransaction = { status, suggestion: invalidSuggestion };
    const validator = vi.spyOn(accountingValidation, "assertValidJournalEntry");

    expect(() => transitionJournalTransaction(transaction, status === "draft" ? "awaiting_approval" : "approved")).toThrow(InvalidJournalEntryError);
    expect(validator).toHaveBeenCalledWith(invalidSuggestion.entry, DEFAULT_CHART_OF_ACCOUNTS);
    expect(transaction.status).toBe(status);
  });

  it("validates approval against the supplied chart without substituting accounts", async () => {
    const transaction = createSuggestedTransaction(await getSuggestion());
    const chartWithoutBank = DEFAULT_CHART_OF_ACCOUNTS.filter(({ id }) => id !== "bank");

    expect(() => transitionJournalTransaction(transaction, "approved", chartWithoutBank)).toThrow(InvalidJournalEntryError);
    expect(transaction.status).toBe("awaiting_approval");
    expect(transaction.suggestion.entry.lines[1].accountId).toBe("bank");
  });
});

describe("explicit approval in chat", () => {
  it("approves only the selected suggestion and treats repeated or stale clicks safely", async () => {
    const first = createSuggestedTransaction(await getSuggestion());
    const second = createSuggestedTransaction(await getSuggestion("approval-entry-2"));
    const messages: ChatMessage[] = [
      { sender: "user", text: rentMessage },
      messageFor(first),
      { sender: "ai", text: "Ordinary financial answer" },
      messageFor(second),
    ];
    freezeRecursively(messages);
    const updated = approveChatTransaction(messages, metadata.id);

    expect(updated[0]).toBe(messages[0]);
    expect(updated[2]).toBe(messages[2]);
    expect(updated[3]).toBe(messages[3]);
    expect(updated[1]).toMatchObject({ transaction: { status: "approved" } });
    expect(messages[1]).toMatchObject({ transaction: { status: "awaiting_approval" } });
    expect(updated[1].sender === "ai" && updated[1].transaction?.suggestion).toBe(first.suggestion);
    expect(approveChatTransaction(updated, metadata.id)).toEqual(updated);
    expect(approveChatTransaction(updated, "missing-entry")).toEqual(updated);
  });

  it("does not approve a draft, a user message, or an ordinary financial reply", async () => {
    const draft = createDraftTransaction(await getSuggestion());
    const messages: ChatMessage[] = [
      { sender: "user", text: "Approve" },
      { sender: "ai", text: "67,130 KWD" },
      messageFor(draft),
    ];
    freezeRecursively(messages);

    expect(approveChatTransaction(messages, metadata.id)).toEqual(messages);
    expect(draft.status).toBe("draft");
  });

  it("approval never posts entries, changes balances, writes storage, or sends a request", async () => {
    const immutableDataset = structuredClone(dataset);
    const accountingBefore = mapFinancialDatasetToAccounting(immutableDataset);
    freezeRecursively(immutableDataset);
    const datasetBefore = JSON.stringify(immutableDataset);
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    const fetcher = vi.fn();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", { localStorage: storage, sessionStorage: storage });
    vi.stubGlobal("fetch", fetcher);
    const saveDataset = vi.spyOn(financialStore, "saveFinancialDataset");
    const balances = vi.spyOn(ledger, "calculateAccountBalances");
    const totals = vi.spyOn(ledger, "calculateLedgerTotals");
    const trialBalance = vi.spyOn(ledger, "createTrialBalance");
    const suggestion = await getSuggestion();
    const messages = [messageFor(createSuggestedTransaction(suggestion))];
    const approved = approveChatTransaction(messages, metadata.id);

    expect(approved[0]).toMatchObject({ transaction: { status: "approved" } });
    expect(JSON.stringify(immutableDataset)).toBe(datasetBefore);
    expect(mapFinancialDatasetToAccounting(immutableDataset)).toEqual(accountingBefore);
    if (!accountingBefore.ok) throw new Error("Expected mapped financial data.");
    expect(accountingBefore.value.journalEntries).toEqual([]);
    expect(saveDataset).not.toHaveBeenCalled();
    expect(balances).not.toHaveBeenCalled();
    expect(totals).not.toHaveBeenCalled();
    expect(trialBalance).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
  });

  it.each([
    ["كم صافي الربح؟", "67,130 KWD"],
    ["شكثر المصاريف؟", "27,870 KWD"],
    ["شنو أكثر مصروف عندي؟", "16,550 KWD"],
  ] as const)("keeps the deterministic financial answer unchanged after approval: %s", async (question, amount) => {
    const analyst = vi.fn();
    const answerBefore = await routeFinancialQuestion(question, dataset, analyst);
    const messages = [messageFor(createSuggestedTransaction(await getSuggestion()))];
    approveChatTransaction(messages, metadata.id);
    const answerAfter = await routeChatMessage(question, dataset, analyst, metadata);

    expect(answerAfter).toEqual(answerBefore);
    expect(answerAfter).toMatchObject({ route: "local", text: expect.stringContaining(amount) });
    expect(analyst).not.toHaveBeenCalled();
  });
});
