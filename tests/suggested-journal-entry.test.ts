import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  parseTransactionIntent,
  suggestJournalEntry,
  type Account,
  type JournalEntry,
  type JournalEntryValidationError,
  type TransactionIntent,
} from "@/lib/accounting";
import * as accountingValidation from "@/lib/accounting/validation";

const ENTRY_OPTIONS = { id: "suggestion-1", date: "2026-10-08" };

function resolvedIntent(description: string): TransactionIntent {
  const result = parseTransactionIntent(description);
  expect(result.status, description).toBe("resolved");
  if (result.status !== "resolved") throw new Error(`Expected a resolved intent: ${description}`);
  return result.intent;
}

function rentIntent(): TransactionIntent {
  return resolvedIntent("دفعت إيجار 600 د.ك من البنك");
}

function suggestedEntry(intent: TransactionIntent, accounts?: readonly Account[]): JournalEntry {
  const result = suggestJournalEntry(intent, { ...ENTRY_OPTIONS, ...(accounts ? { accounts } : {}) });
  expect(result.status).toBe("suggested");
  if (result.status !== "suggested") throw new Error("Expected a suggested journal entry.");
  expect(result.issues).toEqual([]);
  return result.suggestion.entry;
}

function expectIssue(
  result: ReturnType<typeof suggestJournalEntry>,
  code: string,
  status?: "unresolved" | "rejected",
): asserts result is Extract<ReturnType<typeof suggestJournalEntry>, { status: "unresolved" | "rejected" }> {
  if (status) expect(result.status).toBe(status);
  else expect(result.status).not.toBe("suggested");
  expect(result.issues.map((issue) => issue.code)).toContain(code);
  expect(result).not.toHaveProperty("suggestion");
  expect(result).not.toHaveProperty("entry");
  if (result.status === "suggested") throw new Error("Expected an unresolved or rejected result.");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("deterministic suggested journal entries", () => {
  it("rejects malformed categories without coercing arbitrary values into supported categories", () => {
    for (const categoryHint of [["rent"], Object.create(null), Symbol("rent")]) {
      const intent = { ...rentIntent(), categoryHint } as unknown as TransactionIntent;
      expectIssue(suggestJournalEntry(intent, ENTRY_OPTIONS), "INVALID_INTENT", "rejected");
    }
  });

  it("rejects currency whitespace without silently normalizing the evidence", () => {
    const intent = { ...rentIntent(), currency: " USD " };
    const result = suggestJournalEntry(intent, ENTRY_OPTIONS);
    expectIssue(result, "INVALID_CURRENCY", "rejected");
    expect(result.intent.currency).toBe(" USD ");
  });

  it.each([
    ["received electricity invoice 120 KWD unpaid", "accounts-payable"],
    ["sold services to customer for 2000 KWD on account", "accounts-receivable"],
    ["bought a laptop 300 KWD from bank", "computer-equipment"],
  ] as const)("requires the mapped account in the caller's chart: %s", (description, missingId) => {
    const accounts = DEFAULT_CHART_OF_ACCOUNTS.filter(({ id }) => id !== missingId);
    expectIssue(suggestJournalEntry(resolvedIntent(description), { ...ENTRY_OPTIONS, accounts }), "ACCOUNT_NOT_FOUND", "rejected");
  });

  it.each([
    ["دفعت إيجار 600 د.ك من البنك", "expense_payment", 600, "KWD", "rent-expense", "bank"],
    ["استلمت فاتورة كهرباء 120 د.ك وما دفعتها", "expense_on_account", 120, "KWD", "utilities-expense", "accounts-payable"],
    ["received 2,000 USD from customer for services into bank", "revenue_receipt", 2000, "USD", "bank", "revenue"],
    ["بعت للعميل خدمة بـ 2,000 د.ك وما استلمت المبلغ", "revenue_on_account", 2000, "KWD", "accounts-receivable", "revenue"],
    ["اشتريت لابتوب بـ 300 د.ك من البنك", "asset_purchase", 300, "KWD", "computer-equipment", "bank"],
  ] as const)("maps the complete supported intent: %s", (description, intentType, amount, currency, debitId, creditId) => {
    const intent = resolvedIntent(description);
    const result = suggestJournalEntry(intent, ENTRY_OPTIONS);
    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") throw new Error("Expected a suggested entry.");

    expect(intent.intentType).toBe(intentType);
    expect(result.suggestion.intent).toBe(intent);
    expect(result.suggestion.entry).toEqual({
      ...ENTRY_OPTIONS,
      description,
      currency,
      lines: [
        { accountId: debitId, debit: amount, credit: 0 },
        { accountId: creditId, debit: 0, credit: amount },
      ],
    });
    expect(result.issues).toEqual([]);
    const { entry } = result.suggestion;
    expect(entry.lines.reduce((total, line) => total + line.debit, 0)).toBe(amount);
    expect(entry.lines.reduce((total, line) => total + line.credit, 0)).toBe(amount);
    expect(accountingValidation.validateJournalEntry(entry, DEFAULT_CHART_OF_ACCOUNTS)).toEqual({ valid: true, errors: [] });
    expect(entry.lines.every((line) => DEFAULT_CHART_OF_ACCOUNTS.some((account) => account.id === line.accountId))).toBe(true);
  });

  it("maps supported expense categories and explicit cash without defaulting to bank", () => {
    for (const [description, debitId] of [
      ["paid salaries 700 KWD from cash", "salaries-expense"],
      ["paid water 90 KWD from cash", "utilities-expense"],
    ] as const) {
      const entry = suggestedEntry(resolvedIntent(description));
      expect(entry.lines.map(({ accountId }) => accountId)).toEqual([debitId, "cash"]);
    }
  });

  it.each(["bought a computer 300 KWD from bank", "اشتريت حاسوب 300 د.ك من البنك"])("uses the same fixed asset account for computers: %s", (description) => {
    const intent = resolvedIntent(description);
    expect(intent.categoryHint).toBe("computer");
    expect(suggestedEntry(intent).lines).toEqual([
      { accountId: "computer-equipment", debit: 300, credit: 0 },
      { accountId: "bank", debit: 0, credit: 300 },
    ]);
  });

  it.each([
    ["ضخيت 5,000 د.ك في الشركة في البنك", "bank"],
    ["invested 5,000 KWD into company into cash", "cash"],
  ] as const)("maps owner investment only with an explicit supported destination: %s", (description, destinationId) => {
    const intent = resolvedIntent(description);
    const entry = suggestedEntry(intent);
    expect(entry.lines).toEqual([
      { accountId: destinationId, debit: 5000, credit: 0 },
      { accountId: "owners-equity", debit: 0, credit: 5000 },
    ]);
    expect(intent.destinationAccountHint).toEqual({ id: destinationId, type: "asset" });
  });

  it("retains an unresolved bare owner investment without inventing a receiving account", () => {
    const parsed = parseTransactionIntent("ضخيت 5,000 د.ك في الشركة");
    expect(parsed.status).toBe("unresolved");
    expect(parsed.intent.destinationAccountHint).toBeUndefined();
    expectIssue(suggestJournalEntry(parsed.intent as TransactionIntent, ENTRY_OPTIONS), "MISSING_DESTINATION_ACCOUNT", "unresolved");
  });

  it.each(["expense_payment", "asset_purchase"] as const)("refuses a missing payment source for %s", (intentType) => {
    const intent = intentType === "expense_payment"
      ? rentIntent()
      : resolvedIntent("bought a laptop 300 KWD from bank");
    delete intent.sourceAccountHint;
    const result = suggestJournalEntry(intent, ENTRY_OPTIONS);
    expectIssue(result, "MISSING_SOURCE_ACCOUNT", "unresolved");
    expect(result.intent.sourceAccountHint).toBeUndefined();
  });

  it("requires an explicit category for expense, revenue, and asset mappings even when an account hint is present", () => {
    for (const description of [
      "paid rent 600 KWD from bank",
      "received 600 KWD from customer for services into bank",
      "bought a laptop 300 KWD from bank",
    ]) {
      const intent = resolvedIntent(description);
      delete intent.categoryHint;
      expectIssue(suggestJournalEntry(intent, ENTRY_OPTIONS), "MISSING_CATEGORY", "unresolved");
    }
  });

  it("requires the category's account hint instead of inventing an account from the category alone", () => {
    const intent = rentIntent();
    delete intent.accountHint;
    const result = suggestJournalEntry(intent, ENTRY_OPTIONS);
    expectIssue(result, "MISSING_ACCOUNT_HINT", "unresolved");
    expect(result.intent.accountHint).toBeUndefined();
  });

  it.each([
    "received 600 KWD from customer for services into bank",
    "invested 5000 KWD into company into bank",
  ])("requires a receiving account for %s", (description) => {
    const intent = resolvedIntent(description);
    delete intent.destinationAccountHint;
    expectIssue(suggestJournalEntry(intent, ENTRY_OPTIONS), "MISSING_DESTINATION_ACCOUNT", "unresolved");
  });

  it("rejects unsupported source and destination accounts rather than replacing them with bank", () => {
    const source = { ...rentIntent(), sourceAccountHint: { id: "accounts-receivable", type: "asset" as const } };
    const destination = {
      ...resolvedIntent("received 600 KWD from customer for services into bank"),
      destinationAccountHint: { id: "savings-account", type: "asset" as const },
    };
    for (const intent of [source, destination]) {
      const result = suggestJournalEntry(intent, ENTRY_OPTIONS);
      expectIssue(result, "UNSUPPORTED_ACCOUNT", "rejected");
      expect(result.intent).toBe(intent);
    }
  });

  it("rejects a category/account conflict instead of choosing one hint", () => {
    const intent = { ...rentIntent(), accountHint: { id: "salaries-expense", type: "expense" as const } };
    expectIssue(suggestJournalEntry(intent, ENTRY_OPTIONS), "ACCOUNT_HINT_CONFLICT", "rejected");
  });

  it("rejects an unknown account hint without fabricating an account name", () => {
    const intent = { ...rentIntent(), accountHint: { id: "invented-rent-account", type: "expense" as const } };
    const result = suggestJournalEntry(intent, ENTRY_OPTIONS);
    expectIssue(result, "ACCOUNT_HINT_CONFLICT", "rejected");
    expect(result.intent.accountHint).toEqual(intent.accountHint);
    expect(result.intent.accountHint).not.toHaveProperty("name");
  });

  it("rejects payment evidence in the wrong direction", () => {
    const expense = { ...rentIntent(), destinationAccountHint: { id: "cash", type: "asset" as const } };
    const revenue = {
      ...resolvedIntent("received 600 KWD from customer for services into bank"),
      sourceAccountHint: { id: "cash", type: "asset" as const },
    };
    for (const intent of [expense, revenue]) {
      expectIssue(suggestJournalEntry(intent, ENTRY_OPTIONS), "CONFLICTING_ACCOUNT_EVIDENCE", "rejected");
    }
  });

  it("rejects paid/received account evidence on accrued transactions", () => {
    const expense = {
      ...resolvedIntent("received electricity invoice 120 KWD unpaid"),
      sourceAccountHint: { id: "bank", type: "asset" as const },
    };
    const revenue = {
      ...resolvedIntent("sold services to customer for 2000 KWD not received"),
      destinationAccountHint: { id: "bank", type: "asset" as const },
    };
    for (const intent of [expense, revenue]) {
      expectIssue(suggestJournalEntry(intent, ENTRY_OPTIONS), "CONFLICTING_ACCOUNT_EVIDENCE", "rejected");
    }
  });

  it.each(["rent-expense", "bank"])("rejects a required account absent from the supplied chart: %s", (missingId) => {
    const accounts = DEFAULT_CHART_OF_ACCOUNTS.filter(({ id }) => id !== missingId);
    expectIssue(suggestJournalEntry(rentIntent(), { ...ENTRY_OPTIONS, accounts }), "ACCOUNT_NOT_FOUND", "rejected");
  });

  it("does not fall back to the default chart when an explicit empty chart is supplied", () => {
    expectIssue(suggestJournalEntry(rentIntent(), { ...ENTRY_OPTIONS, accounts: [] }), "ACCOUNT_NOT_FOUND", "rejected");
  });

  it("uses supported identifiers from a custom chart without depending on account display names", () => {
    const accounts: Account[] = DEFAULT_CHART_OF_ACCOUNTS
      .filter(({ id }) => id === "rent-expense" || id === "bank")
      .map((account) => ({ ...account, name: `Custom ${account.code}` }));
    const entry = suggestedEntry(rentIntent(), accounts);
    expect(entry.lines.map(({ accountId }) => accountId)).toEqual(["rent-expense", "bank"]);
    expect(accountingValidation.validateJournalEntry(entry, accounts).valid).toBe(true);
  });

  it("rejects duplicate candidate account IDs instead of selecting an arbitrary record", () => {
    const bank = DEFAULT_CHART_OF_ACCOUNTS.find(({ id }) => id === "bank")!;
    const accounts = [...DEFAULT_CHART_OF_ACCOUNTS, { ...bank, name: "Other bank" }];
    expectIssue(suggestJournalEntry(rentIntent(), { ...ENTRY_OPTIONS, accounts }), "AMBIGUOUS_ACCOUNT", "rejected");
  });

  it("rejects an account whose chart type contradicts the mapping", () => {
    const accounts: Account[] = DEFAULT_CHART_OF_ACCOUNTS.map((account) => (
      account.id === "bank" ? { ...account, type: "liability" } : account
    ));
    expectIssue(suggestJournalEntry(rentIntent(), { ...ENTRY_OPTIONS, accounts }), "ACCOUNT_TYPE_MISMATCH", "rejected");
  });

  it("rejects nonpositive, nonfinite, and unsafe amounts before returning an entry", () => {
    for (const amount of [0, -600, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expectIssue(suggestJournalEntry({ ...rentIntent(), amount }, ENTRY_OPTIONS), "INVALID_AMOUNT", "rejected");
    }
  });

  it("preserves fractional amounts and explicit currencies without conversion or rounding", () => {
    for (const currency of ["KWD", "USD", "EUR", "JPY"] as const) {
      const intent = resolvedIntent(`paid rent 600.125 ${currency} from bank`);
      const entry = suggestedEntry(intent);
      expect(entry.currency).toBe(currency);
      expect(entry.lines).toEqual([
        { accountId: "rent-expense", debit: 600.125, credit: 0 },
        { accountId: "bank", debit: 0, credit: 600.125 },
      ]);
    }
  });

  it.each(["usd", "", "USD KWD"])("returns Accounting Core currency errors for malformed currency %j", (currency) => {
    const intent = { ...rentIntent(), currency };
    const result = suggestJournalEntry(intent, ENTRY_OPTIONS);
    expectIssue(result, "ACCOUNTING_VALIDATION_FAILED", "rejected");
    const failedValidation = accountingValidation.validateJournalEntry({
      ...ENTRY_OPTIONS,
      description: intent.description,
      currency,
      lines: [
        { accountId: "rent-expense", debit: intent.amount, credit: 0 },
        { accountId: "bank", debit: 0, credit: intent.amount },
      ],
    }, DEFAULT_CHART_OF_ACCOUNTS);
    expect(result.issues.find(({ code }) => code === "ACCOUNTING_VALIDATION_FAILED")?.validationErrors).toEqual(failedValidation.errors);
  });

  it("requires an explicit entry ID without generating one", () => {
    expectIssue(suggestJournalEntry(rentIntent(), { ...ENTRY_OPTIONS, id: " " }), "MISSING_ENTRY_ID", "unresolved");
  });

  it("requires a real explicit date without using the current date", () => {
    for (const date of ["", "not-a-date", "2026-02-30"]) {
      expectIssue(suggestJournalEntry(rentIntent(), { ...ENTRY_OPTIONS, date }), "INVALID_ENTRY_DATE");
    }
  });

  it("preserves original evidence, leaves inputs untouched, and produces deterministic suggestions without persistence", () => {
    const intent = resolvedIntent('paid rent 600 KWD from cash to supplier "Acme"');
    Object.freeze(intent.accountHint);
    Object.freeze(intent.sourceAccountHint);
    Object.freeze(intent.counterparty);
    Object.freeze(intent);
    const accounts = Object.freeze(DEFAULT_CHART_OF_ACCOUNTS.map((account) => Object.freeze({ ...account })));
    const intentBefore = JSON.stringify(intent);
    const accountsBefore = JSON.stringify(accounts);
    const storage = { setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), getItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);

    const first = suggestJournalEntry(intent, { ...ENTRY_OPTIONS, accounts });
    const second = suggestJournalEntry(intent, { ...ENTRY_OPTIONS, accounts });
    expect(first.status).toBe("suggested");
    expect(second).toEqual(first);
    if (first.status !== "suggested") throw new Error("Expected a suggested entry.");
    expect(first.suggestion.intent).toBe(intent);
    expect(first.suggestion.intent.sourceAccountHint).toEqual({ id: "cash", type: "asset" });
    expect(first.suggestion.intent.counterparty).toEqual({ role: "supplier", name: "Acme" });
    expect(JSON.stringify(intent)).toBe(intentBefore);
    expect(JSON.stringify(accounts)).toBe(accountsBefore);
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
  });

  it("calls the existing Accounting Core validator with the candidate entry and selected chart", () => {
    const validator = vi.spyOn(accountingValidation, "validateJournalEntry");
    const intent = rentIntent();
    const accounts = DEFAULT_CHART_OF_ACCOUNTS.filter(({ id }) => id === "bank" || id === "rent-expense");
    const result = suggestJournalEntry(intent, { ...ENTRY_OPTIONS, accounts });
    expect(result.status).toBe("suggested");
    if (result.status !== "suggested") throw new Error("Expected a suggested entry.");
    expect(validator).toHaveBeenCalledTimes(1);
    expect(validator).toHaveBeenCalledWith(result.suggestion.entry, accounts);
    expect(validator.mock.results[0].value).toEqual({ valid: true, errors: [] });
  });

  it("propagates Accounting Core validation failures and never returns a suggestion after rejection", () => {
    const errors: JournalEntryValidationError[] = [
      { code: "UNBALANCED_ENTRY", message: "Core rejected the candidate entry." },
    ];
    const validator = vi.spyOn(accountingValidation, "validateJournalEntry").mockReturnValue({ valid: false, errors });
    const result = suggestJournalEntry(rentIntent(), ENTRY_OPTIONS);
    expectIssue(result, "ACCOUNTING_VALIDATION_FAILED", "rejected");
    expect(validator).toHaveBeenCalledTimes(1);
    expect(result.issues.find(({ code }) => code === "ACCOUNTING_VALIDATION_FAILED")?.validationErrors).toBe(errors);
  });
});
