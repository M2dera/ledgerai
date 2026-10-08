import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS, type JournalEntryValidationError } from "@/lib/accounting";
import * as entrySuggestions from "@/lib/accounting/suggested-journal-entry";
import * as accountingValidation from "@/lib/accounting/validation";
import { analyzeData, createUploadedFile } from "@/lib/analysis/analyzer";
import { routeFinancialQuestion } from "@/lib/analysis/chat";
import type { AnalystInterpretation, AnalystRequest } from "@/lib/ai/types";
import { routeChatMessage } from "@/lib/chat";
import { readExcel } from "@/lib/excel/reader";
import type { FinancialDataset } from "@/lib/financial/types";
import * as financialStore from "@/lib/store/financialStore";

const ENTRY_OPTIONS = { id: "chat-suggestion-1", date: "2026-10-08" };
const RENT_TRANSACTION = "دفعت إيجار 600 د.ك من البنك";
const analystResponse: AnalystInterpretation = {
  provider: "ollama",
  interpretation: "Review the largest expense category using the supplied evidence.",
  investigateNext: ["Review Payroll."],
  uncertainty: [],
  factRefs: [],
};

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

describe("chat transaction and financial routing", () => {
  it.each([
    [RENT_TRANSACTION, 600, "rent-expense", "bank"],
    ["استلمت فاتورة كهرباء 120 د.ك وما دفعتها", 120, "utilities-expense", "accounts-payable"],
    ["استلمت من العميل 2,000 د.ك مقابل خدمة في البنك", 2000, "bank", "revenue"],
    ["بعت للعميل خدمة بـ 2,000 د.ك وما استلمت المبلغ", 2000, "accounts-receivable", "revenue"],
    ["اشتريت لابتوب بـ 300 د.ك من البنك", 300, "computer-equipment", "bank"],
    ["ضخيت 5,000 د.ك في الشركة في البنك", 5000, "bank", "owners-equity"],
  ] as const)("returns a validated proposal for the supported transaction: %s", async (message, amount, debitId, creditId) => {
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeChatMessage(message, null, analyst, ENTRY_OPTIONS);

    expect(result).toMatchObject({ route: "transaction", status: "suggested" });
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected an accounting suggestion.");
    expect(result.suggestion.entry).toEqual({
      ...ENTRY_OPTIONS,
      description: message,
      currency: "KWD",
      lines: [
        { accountId: debitId, debit: amount, credit: 0 },
        { accountId: creditId, debit: 0, credit: amount },
      ],
    });
    expect(result.suggestion.intent.description).toBe(message);
    expect(analyst).not.toHaveBeenCalled();
  });

  it("uses the existing suggestion engine and Accounting Core validator exactly once", async () => {
    const suggest = vi.spyOn(entrySuggestions, "suggestJournalEntry");
    const validate = vi.spyOn(accountingValidation, "validateJournalEntry");
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeChatMessage(RENT_TRANSACTION, dataset, analyst, ENTRY_OPTIONS);

    expect(result).toMatchObject({ route: "transaction", status: "suggested" });
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected an accounting suggestion.");
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest).toHaveBeenCalledWith(result.suggestion.intent, ENTRY_OPTIONS);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(result.suggestion.entry, DEFAULT_CHART_OF_ACCOUNTS);
    expect(validate.mock.results[0].value).toEqual({ valid: true, errors: [] });
    expect(analyst).not.toHaveBeenCalled();
  });

  it.each([
    ["دفعنا الايجار 600 د ك من بنك", 600, "rent-expense", "bank"],
    ["دفعت رواتب 900 دينار كويتي من الصندوق", 900, "salaries-expense", "cash"],
    ["دفعت أجور 900 د.ك من الكاش", 900, "salaries-expense", "cash"],
    ["دفعنا ماي 30 د.ك من البنك", 30, "utilities-expense", "bank"],
    ["دفعت مياه 30 د.ك من البنك", 30, "utilities-expense", "bank"],
    ["استلمنا فاتورة خدمات 120 د.ك وما دفعناها", 120, "utilities-expense", "accounts-payable"],
    ["بعنا لعميل خدمة ب2000 د.ك وما استلمنا المبلغ", 2000, "accounts-receivable", "revenue"],
    ["ضخت 5000 د.ك في شركة الى البنك", 5000, "bank", "owners-equity"],
    ["استثمرت 5000 د.ك في الشركة في البنك", 5000, "bank", "owners-equity"],
    ["دفعت إيجار ١٬٢٠٠٫٥٠٠ د.ك من البنك", 1200.5, "rent-expense", "bank"],
    ["دفعت إيجار ۱٬۲۰۰٫۵۰۰ د.ك من البنك", 1200.5, "rent-expense", "bank"],
    ["paid rent 600 KWD from cash", 600, "rent-expense", "cash"],
  ] as const)("preserves supported spelling, account, and digit variants: %s", async (message, amount, debitId, creditId) => {
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeChatMessage(message, dataset, analyst, ENTRY_OPTIONS);

    expect(result).toMatchObject({
      route: "transaction",
      status: "suggested",
      suggestion: { entry: { currency: "KWD", lines: [
        { accountId: debitId, debit: amount, credit: 0 },
        { accountId: creditId, debit: 0, credit: amount },
      ] } },
    });
    expect(analyst).not.toHaveBeenCalled();
  });

  it("asks for the missing payment account without creating a suggestion or invoking AI", async () => {
    const suggest = vi.spyOn(entrySuggestions, "suggestJournalEntry");
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeChatMessage("دفعت إيجار 600 د.ك", dataset, analyst, ENTRY_OPTIONS);

    expect(result).toEqual({
      route: "transaction",
      status: "unresolved",
      text: "من أي حساب تم الدفع: البنك أم الصندوق؟",
      issues: [expect.objectContaining({ code: "MISSING_SOURCE_ACCOUNT" })],
    });
    expect(result).not.toHaveProperty("suggestion");
    expect(suggest).not.toHaveBeenCalled();
    expect(analyst).not.toHaveBeenCalled();
  });

  it.each([
    ["دفعت إيجار 600 د.ك من البنك والكاش", "AMBIGUOUS_ACCOUNT"],
    ["ضخيت 5,000 د.ك في الشركة", "MISSING_DESTINATION_ACCOUNT"],
    ["استلمت من العميل 2,000 د.ك", "REVENUE_CONTEXT_REQUIRED"],
    ["اشتريت لابتوب بـ 300 د.ك", "MISSING_SOURCE_ACCOUNT"],
  ] as const)("keeps incomplete or ambiguous accounting evidence unresolved: %s", async (message, issueCode) => {
    const suggest = vi.spyOn(entrySuggestions, "suggestJournalEntry");
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeChatMessage(message, dataset, analyst, ENTRY_OPTIONS);

    expect(result).toMatchObject({ route: "transaction", status: "unresolved", issues: expect.arrayContaining([expect.objectContaining({ code: issueCode })]) });
    expect(result).not.toHaveProperty("suggestion");
    expect("text" in result && result.text.length).toBeGreaterThan(0);
    expect(suggest).not.toHaveBeenCalled();
    expect(analyst).not.toHaveBeenCalled();
  });

  it.each([
    ["كم صافي الربح؟", "deterministic_metric", "67,130 KWD", undefined],
    ["شكثر المصاريف؟", "deterministic_metric", "27,870 KWD", undefined],
    ["شنو أكثر مصروف عندي؟", "category_ranking", "16,550 KWD", "Payroll"],
    ["كم الإيجار؟", "category_metric", "6,000 KWD", "Rent"],
    ["كم صرفت على التسويق؟", "category_metric", "4,420 KWD", "Marketing"],
    ["What is my highest expense?", "category_ranking", "16,550 KWD", "Payroll"],
  ] as const)("preserves the existing deterministic financial answer: %s", async (question, intent, amount, category) => {
    const suggest = vi.spyOn(entrySuggestions, "suggestJournalEntry");
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeChatMessage(question, dataset, analyst, ENTRY_OPTIONS);
    const existingAnswer = await routeFinancialQuestion(question, dataset, analyst);

    expect(result).toEqual(existingAnswer);
    expect(result).toMatchObject({ route: "local", intent });
    expect("text" in result && result.text).toContain(amount);
    if (category) expect("text" in result && result.text).toContain(category);
    expect(suggest).not.toHaveBeenCalled();
    expect(analyst).not.toHaveBeenCalled();
  });

  it("continues to delegate interpretive financial questions using deterministic context", async () => {
    const suggest = vi.spyOn(entrySuggestions, "suggestJournalEntry");
    const analyst = vi.fn(async ({ context }: AnalystRequest) => ({ ...analystResponse, factRefs: [context.categories[0].factId] }));
    const question = "وين تشوف المشكلة؟";
    const result = await routeChatMessage(question, dataset, analyst, ENTRY_OPTIONS);

    expect(result).toMatchObject({ route: "analyst", intent: "interpretive_financial", interpretation: await analyst.mock.results[0].value });
    expect(analyst).toHaveBeenCalledTimes(1);
    expect(analyst.mock.calls[0][0].question).toBe(question);
    expect(analyst.mock.calls[0][0].context.categories[0]).toMatchObject({ label: { value: "Payroll" }, expenses: 16550 });
    expect(result.route === "analyst" && result.facts).toContainEqual({ label: "Payroll", value: 16550, unit: { kind: "currency", unit: dataset.currency } });
    expect(suggest).not.toHaveBeenCalled();
  });

  it.each([
    "دفعت إيجار 0 د.ك من البنك",
    "paid rent -600 KWD from bank",
    "paid rent 600.1234 KWD from bank",
    "اشتريت سيارة 300 د.ك من البنك",
    "paid rent 600 KWD from bank and borrowed 200 KWD",
    "paid rent 600 KWD from bank " + "x".repeat(1001),
  ])("returns safe feedback for invalid or unsupported completed-action messages: %s", async (message) => {
    const suggest = vi.spyOn(entrySuggestions, "suggestJournalEntry");
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeChatMessage(message, dataset, analyst, ENTRY_OPTIONS);

    expect(result.route).toBe("transaction");
    if (result.route !== "transaction" || result.status === "suggested") throw new Error("Expected a safe accounting fallback.");
    expect(["unresolved", "unsupported", "rejected"]).toContain(result.status);
    expect(result.text.trim()).not.toBe("");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("suggestion");
    expect(suggest).not.toHaveBeenCalled();
    expect(analyst).not.toHaveBeenCalled();
  });

  it.each([
    "I will pay rent 600 KWD from bank",
    "if I paid rent 600 KWD from bank",
    "did not pay rent 600 KWD from bank",
    "ما دفعت إيجار 600 د.ك من البنك",
    "paid a loan 600 KWD from bank",
    "received 600 KWD customer refund into bank",
    "transfer 600 KWD from bank to cash",
    "bought a car 300 KWD from bank",
    "paid marketing 600 KWD from bank",
    "استلمت فاتورة كهرباء 120 د.ك ودفعتها",
    "دفعت إيجار 600 د.ك من البنك؟",
    "paid rent 600 KWD from bank?",
    "paid rent 600 KWD from bank to supplier ＠name",
  ])("leaves unsupported action meanings safely unsupported: %s", async (message) => {
    const suggest = vi.spyOn(entrySuggestions, "suggestJournalEntry");
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeChatMessage(message, dataset, analyst, ENTRY_OPTIONS);

    expect(result).toMatchObject({ route: "transaction", status: "unsupported" });
    if (result.route !== "transaction" || result.status === "suggested") throw new Error("Expected a safe accounting fallback.");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.text.trim()).not.toBe("");
    expect(result).not.toHaveProperty("suggestion");
    expect(suggest).not.toHaveBeenCalled();
    expect(analyst).not.toHaveBeenCalled();
  });

  it("never displays a suggestion rejected by Accounting Core validation", async () => {
    const errors: JournalEntryValidationError[] = [{ code: "UNBALANCED_ENTRY", message: "Core rejected the candidate entry." }];
    const validator = vi.spyOn(accountingValidation, "validateJournalEntry").mockReturnValue({ valid: false, errors });
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeChatMessage(RENT_TRANSACTION, dataset, analyst, ENTRY_OPTIONS);

    expect(result).toMatchObject({ route: "transaction", status: "rejected", issues: [{ code: "ACCOUNTING_VALIDATION_FAILED", validationErrors: errors }] });
    expect(result).not.toHaveProperty("suggestion");
    expect("text" in result && result.text.trim()).not.toBe("");
    expect(validator).toHaveBeenCalledTimes(1);
    expect(analyst).not.toHaveBeenCalled();
  });

  it("creates transient suggestions without posting, storage writes, or changes to the dataset", async () => {
    const immutableDataset = structuredClone(dataset);
    function freezeRecursively(value: unknown): void {
      if (typeof value !== "object" || value === null) return;
      Object.values(value).forEach(freezeRecursively);
      Object.freeze(value);
    }
    freezeRecursively(immutableDataset);
    const before = JSON.stringify(immutableDataset);
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    const fetcher = vi.fn();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", { localStorage: storage, sessionStorage: storage });
    vi.stubGlobal("fetch", fetcher);
    const saveDataset = vi.spyOn(financialStore, "saveFinancialDataset");
    const analyst = vi.fn(async () => analystResponse);

    const first = await routeChatMessage(RENT_TRANSACTION, immutableDataset, analyst, ENTRY_OPTIONS);
    const second = await routeChatMessage(RENT_TRANSACTION, immutableDataset, analyst, ENTRY_OPTIONS);
    const unresolved = await routeChatMessage("دفعت إيجار 600 د.ك", immutableDataset, analyst, ENTRY_OPTIONS);
    const profit = await routeChatMessage("كم صافي الربح؟", immutableDataset, analyst, ENTRY_OPTIONS);

    expect(first).toMatchObject({ route: "transaction", status: "suggested" });
    expect(second).toEqual(first);
    expect(unresolved).toMatchObject({ route: "transaction", status: "unresolved" });
    expect(profit).toMatchObject({ route: "local", text: expect.stringContaining("67,130 KWD") });
    expect(JSON.stringify(immutableDataset)).toBe(before);
    expect(saveDataset).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
    expect(analyst).not.toHaveBeenCalled();
  });
});
