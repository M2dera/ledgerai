import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS, parseTransactionIntent } from "@/lib/accounting";

describe("deterministic transaction intents", () => {
  it.each([
    "دفعت إيجار 600 د.ك من البنك؟",
    "paid rent 600 KWD from bank?",
    "paid rent 600 KWD from bank to supplier ＠name",
  ])("does not turn questions or normalized internal markers into accounting facts: %s", (description) => {
    const result = parseTransactionIntent(description);
    expect(result.status).toBe("unsupported");
    expect(result.intent.accountHint).toBeUndefined();
    expect(result.intent.counterparty).toBeUndefined();
  });

  it.each([
    ["دفعت إيجار 600 د.ك من البنك", "expense_payment", 600, "rent", "rent-expense", "expense", "sourceAccountHint"],
    ["paid rent 600 KWD from bank", "expense_payment", 600, "rent", "rent-expense", "expense", "sourceAccountHint"],
    ["استلمت فاتورة كهرباء 120 د.ك وما دفعتها", "expense_on_account", 120, "utilities", "utilities-expense", "expense", undefined],
    ["received an electricity invoice for 120 KWD unpaid", "expense_on_account", 120, "utilities", "utilities-expense", "expense", undefined],
    ["استلمت من العميل 2,000 د.ك مقابل خدمة في البنك", "revenue_receipt", 2000, "services", "revenue", "revenue", "destinationAccountHint"],
    ["received 2,000 KWD from the customer for services into bank", "revenue_receipt", 2000, "services", "revenue", "revenue", "destinationAccountHint"],
    ["بعت للعميل خدمة بـ 2,000 د.ك وما استلمت المبلغ", "revenue_on_account", 2000, "services", "revenue", "revenue", undefined],
    ["sold a service to the customer for 2,000 KWD on account", "revenue_on_account", 2000, "services", "revenue", "revenue", undefined],
    ["ضخيت 5,000 د.ك في الشركة في البنك", "owner_investment", 5000, undefined, "owners-equity", "equity", "destinationAccountHint"],
    ["invested 5,000 KWD into the company into bank", "owner_investment", 5000, undefined, "owners-equity", "equity", "destinationAccountHint"],
  ] as const)("resolves the explicit clause %s", (description, intentType, amount, categoryHint, accountId, accountType, settlementHint) => {
    const result = parseTransactionIntent(description);

    expect(result.status).toBe("resolved");
    expect(result.issues).toEqual([]);
    expect(result.intent).toMatchObject({
      description,
      intentType,
      amount,
      currency: "KWD",
      accountHint: { id: accountId, type: accountType },
    });
    expect(result.intent.categoryHint).toBe(categoryHint);
    if (settlementHint) {
      expect(result.intent[settlementHint]).toEqual({ id: "bank", type: "asset" });
    }
    expect(result).not.toHaveProperty("journalEntries");
    expect(result.intent).not.toHaveProperty("lines");
  });

  it("supports the documented Kuwaiti spelling and action variations", () => {
    const cases = [
      ["دفعنا الايجار 600 د ك من بنك", "expense_payment", "rent"],
      ["دفعت رواتب 900 دينار كويتي من الصندوق", "expense_payment", "salaries"],
      ["دفعت أجور 900 د.ك من الكاش", "expense_payment", "salaries"],
      ["دفعنا ماي 30 د.ك من البنك", "expense_payment", "utilities"],
      ["دفعت مياه 30 د.ك من البنك", "expense_payment", "utilities"],
      ["استلمنا فاتورة خدمات 120 د.ك وما دفعناها", "expense_on_account", "utilities"],
      ["بعنا لعميل خدمة ب2000 د.ك وما استلمنا المبلغ", "revenue_on_account", "services"],
      ["ضخت 5000 د.ك في شركة الى البنك", "owner_investment", undefined],
      ["استثمرت 5000 د.ك في الشركة في البنك", "owner_investment", undefined],
    ] as const;

    for (const [text, intentType, categoryHint] of cases) {
      const result = parseTransactionIntent(text);
      expect(result, text).toMatchObject({ status: "resolved", intent: { intentType } });
      expect(result.intent.categoryHint, text).toBe(categoryHint);
    }
  });

  it.each([
    "اشتريت لابتوب بـ 300 د.ك من البنك",
    "purchased a laptop 300 KWD from bank",
  ])("resolves an explicit laptop purchase with the supported fixed-asset account: %s", (description) => {
    const result = parseTransactionIntent(description);

    expect(result).toMatchObject({
      status: "resolved",
      intent: {
        intentType: "asset_purchase",
        amount: 300,
        currency: "KWD",
        categoryHint: "laptop",
        accountHint: { id: "computer-equipment", type: "asset" },
        sourceAccountHint: { id: "bank", type: "asset" },
      },
    });
    expect(result.issues).toEqual([]);
  });

  it("maps only explicit laptop/computer hints to the existing Computer Equipment account", () => {
    for (const [description, categoryHint] of [
      ["شريت لابتوب 300 د.ك من البنك", "laptop"],
      ["bought a computer 300 KWD from bank", "computer"],
      ["اشتريت حاسوب 300 د.ك من البنك", "computer"],
    ] as const) {
      const result = parseTransactionIntent(description);
      expect(result, description).toMatchObject({ status: "resolved", intent: { intentType: "asset_purchase", categoryHint } });
      expect(result.intent.accountHint).toEqual({ id: "computer-equipment", type: "asset" });
      expect(DEFAULT_CHART_OF_ACCOUNTS.some((account) => account.id === result.intent.accountHint?.id)).toBe(true);
    }
  });

  it.each(["اشتريت لابتوب بـ 300 د.ك", "bought a computer 300 KWD"])("leaves asset purchases unresolved without explicit payment sources: %s", (description) => {
    const result = parseTransactionIntent(description);
    expect(result.status).toBe("unresolved");
    expect(result.intent.accountHint).toEqual({ id: "computer-equipment", type: "asset" });
    expect(result.intent.sourceAccountHint).toBeUndefined();
    expect(result.issues.map(({ code }) => code)).toEqual(["MISSING_SOURCE_ACCOUNT"]);
  });

  it.each(["اشتريت بـ 300 د.ك من البنك", "bought 300 KWD from bank"])("does not select Computer Equipment without a supported asset category: %s", (description) => {
    const result = parseTransactionIntent(description);
    expect(result.status).toBe("unresolved");
    expect(result.intent.categoryHint).toBeUndefined();
    expect(result.intent.accountHint).toBeUndefined();
    expect(result.intent.sourceAccountHint).toEqual({ id: "bank", type: "asset" });
    expect(result.issues.map(({ code }) => code)).toEqual(["MISSING_CATEGORY", "ASSET_ACCOUNT_REQUIRED"]);
  });

  it.each(["KWD", "SAR", "AED", "USD", "EUR", "GBP", "CAD", "AUD", "JPY"])("preserves the explicit %s currency without conversion", (currency) => {
    const result = parseTransactionIntent(`paid rent 600 ${currency} from bank`);
    expect(result).toMatchObject({ status: "resolved", intent: { amount: 600, currency } });
  });

  it("normalizes Arabic and Persian digits, separators, and a three-decimal amount", () => {
    for (const description of ["دفعت إيجار ١٬٢٠٠٫٥٠٠ د.ك من البنك", "دفعت إيجار ۱٬۲۰۰٫۵۰۰ د.ك من البنك", "paid rent 1,200.500 KD from bank"]) {
      expect(parseTransactionIntent(description), description).toMatchObject({
        status: "resolved",
        intent: { amount: 1200.5, currency: "KWD" },
      });
    }
  });

  it("retains the original description and only explicitly stated counterparty names", () => {
    const description = 'paid rent 600 KWD from cash to supplier "Acme"';
    const result = parseTransactionIntent(description);
    expect(result).toMatchObject({
      status: "resolved",
      intent: { description, sourceAccountHint: { id: "cash", type: "asset" }, counterparty: { role: "supplier", name: "Acme" } },
    });
    const unnamed = parseTransactionIntent("استلمت من العميل 2000 د.ك مقابل خدمات في البنك");
    expect(unnamed.intent.counterparty).toEqual({ role: "customer" });
    const unspecified = parseTransactionIntent("دفعت إيجار 600 د.ك من البنك");
    expect(unspecified.intent.counterparty).toBeUndefined();
    const nameWithFinancialWords = parseTransactionIntent('paid rent 600 KWD from cash to supplier "Bank 123 USD"');
    expect(nameWithFinancialWords).toMatchObject({
      status: "resolved",
      intent: { amount: 600, currency: "KWD", sourceAccountHint: { id: "cash", type: "asset" }, counterparty: { role: "supplier", name: "Bank 123 USD" } },
    });
    const arabicSupplier = parseTransactionIntent('دفعت إيجار 600 د.ك من البنك للمورد "أحمد"');
    expect(arabicSupplier).toMatchObject({ status: "resolved", intent: { counterparty: { role: "supplier", name: "أحمد" } } });
  });

  it.each([
    ["دفعت 600 د.ك", ["MISSING_CATEGORY", "MISSING_SOURCE_ACCOUNT"], undefined, undefined],
    ["دفعت إيجار 600 د.ك", ["MISSING_SOURCE_ACCOUNT"], "rent", undefined],
    ["paid 600 KWD from bank", ["MISSING_CATEGORY"], undefined, "bank"],
    ["paid rent 600 from bank", ["MISSING_CURRENCY"], "rent", "bank"],
    ["ضخيت 5,000 د.ك في الشركة", ["MISSING_DESTINATION_ACCOUNT"], undefined, undefined],
    ["invested 5000 KWD into company", ["MISSING_DESTINATION_ACCOUNT"], undefined, undefined],
  ] as const)("returns known facts and explicit missing-information issues: %s", (description, missingCodes, categoryHint, sourceId) => {
    const result = parseTransactionIntent(description);
    expect(result.status).toBe("unresolved");
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([...missingCodes]));
    expect(result.intent.categoryHint).toBe(categoryHint);
    expect(result.intent.sourceAccountHint?.id).toBe(sourceId);
    if (categoryHint === undefined && result.intent.intentType === "expense_payment") {
      expect(result.intent.accountHint).toBeUndefined();
    }
  });

  it("does not infer service revenue or a deposit account from a bare customer receipt", () => {
    const result = parseTransactionIntent("استلمت من العميل 2,000 د.ك");
    expect(result).toMatchObject({ status: "unresolved", intent: { intentType: "revenue_receipt", amount: 2000, currency: "KWD", counterparty: { role: "customer" } } });
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining(["REVENUE_CONTEXT_REQUIRED", "MISSING_DESTINATION_ACCOUNT"]));
    expect(result.intent.accountHint).toBeUndefined();
    expect(result.intent.destinationAccountHint).toBeUndefined();
  });

  it.each([
    "paid rent 600 $ from bank",
    "paid rent 600 ¥ from bank",
    "paid rent 600 KWD USD from bank",
    "paid rent 600 KWD and 120 KWD from bank",
    "paid rent 600 KWD from bank and borrowed 200 KWD",
    "paid rent and salaries 600 KWD from bank",
    "دفعت إيجار وكهرباء 600 د.ك من البنك",
    "paid rent 600 KWD from bank and cash",
    "دفعت إيجار 600 د.ك من البنك والكاش",
    "paid rent 1,20 KWD from bank",
    "paid rent 6,000,00 KWD from bank",
    "paid rent -600 KWD from bank",
    "paid rent 0 KWD from bank",
    "paid rent 600.1234 KWD from bank",
    "paid rent 600-700 KWD from bank",
    "paid rent 6e2 KWD from bank",
  ])("never resolves an ambiguous or invalid amount/account/currency clause: %s", (description) => {
    const result = parseTransactionIntent(description);
    expect(result.status).not.toBe("resolved");
    expect(result.issues.length).toBeGreaterThan(0);
    if (description.includes("$") || description.includes("¥") || description.includes("KWD USD")) {
      expect(result.intent.currency).toBeUndefined();
    }
    if (description.includes("and cash") || description.includes("والكاش")) {
      expect(result.intent.sourceAccountHint).toBeUndefined();
    }
    if (description.includes("rent and salaries") || description.includes("إيجار وكهرباء")) {
      expect(result.intent.categoryHint).toBeUndefined();
      expect(result.intent.accountHint).toBeUndefined();
    }
  });

  it("uses only existing account identifiers, including in partial results", () => {
    const knownIds = new Set(DEFAULT_CHART_OF_ACCOUNTS.map(({ id }) => id));
    for (const description of [
      "دفعت 600 د.ك",
      "دفعت إيجار 600 د.ك",
      "دفعت إيجار 600 د.ك من البنك",
      "اشتريت لابتوب 300 د.ك من البنك",
      "استلمت من العميل 2,000 د.ك",
      "ضخيت 5000 د.ك في الشركة",
    ]) {
      const { intent } = parseTransactionIntent(description);
      for (const hint of [intent.accountHint, intent.sourceAccountHint, intent.destinationAccountHint]) {
        if (hint) {
          expect(knownIds.has(hint.id as (typeof DEFAULT_CHART_OF_ACCOUNTS)[number]["id"]), description).toBe(true);
          expect(hint).not.toHaveProperty("name");
        }
      }
    }
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
  ])("rejects unsupported actions, accounting meanings, and leftover text: %s", (description) => {
    const result = parseTransactionIntent(description);
    expect(result.status).toBe("unsupported");
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("safely rejects malformed descriptions without coercing arbitrary values", () => {
    for (const description of [undefined, null, 600, {}, [], "", "   ", "not a transaction", "x".repeat(1001), "paid rent @amount KWD from bank"]) {
      const result = parseTransactionIntent(description);
      expect(result.status).toBe("unsupported");
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.intent.amount).toBeUndefined();
      expect(result.intent.accountHint).toBeUndefined();
    }
  });

  it("requires an amount for a known clause and rejects an empty quoted counterparty name", () => {
    const missingAmount = parseTransactionIntent("paid rent KWD from bank");
    expect(missingAmount.status).toBe("unresolved");
    expect(missingAmount.issues.map(({ code }) => code)).toContain("MISSING_AMOUNT");
    expect(missingAmount.intent.amount).toBeUndefined();
    const emptyName = parseTransactionIntent('paid rent 600 KWD from bank to supplier "   "');
    expect(emptyName.status).toBe("unsupported");
    expect(emptyName.intent.counterparty).toBeUndefined();
  });

  it("does not reverse a source/destination or turn customer advances and collections into revenue", () => {
    for (const description of [
      "paid rent 600 KWD into bank",
      "received 600 KWD from customer for services from bank",
      "received 600 KWD from customer as an advance into bank",
      "received 600 KWD from customer for an existing invoice into bank",
      "دفعت إيجار 600 دينار من البنك",
    ]) {
      const result = parseTransactionIntent(description);
      expect(result.status, description).not.toBe("resolved");
      expect(result.intent.accountHint, description).toBeUndefined();
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});
