import { describe, expect, it, vi } from "vitest";
import { routeChatMessage } from "@/lib/chat";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { validateTransactionInterpretation, type TransactionInterpretationCandidate } from "@/lib/accounting/transaction-understanding";
import { createSuggestedTransaction } from "@/lib/accounting/transaction-workflow";

const description = "Settled our office rent using cash for 1,200 SAR";
const candidate: TransactionInterpretationCandidate = {
  intentType: "expense_payment",
  actionEvidence: "Settled our office rent",
  categoryEvidence: "office rent",
  accountEvidence: "using cash",
  accountRole: "source",
};
const officeRentCandidate: TransactionInterpretationCandidate = {
  intentType: "expense_payment",
  actionEvidence: "Paid office rent",
  categoryEvidence: "office rent",
  accountEvidence: "bank account",
  accountRole: "source",
};
const options = { id: "ai-suggestion-1", date: "2026-10-10" };

describe("AI-assisted transaction understanding", () => {
  it("routes the office-rent paraphrase through AI, grounds Bank, and returns the awaiting-approval entry", async () => {
    const input = "Paid office rent of 600 KWD from the bank account.";
    expect(parseTransactionIntent(input)).toMatchObject({ status: "unsupported", intent: { amount: 600, currency: "KWD" } });
    const interpreter = vi.fn(async () => officeRentCandidate);
    const result = await routeChatMessage(input, null, vi.fn(), { ...options, requestTransactionInterpreter: interpreter });
    expect(interpreter).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ route: "transaction", status: "suggested", assisted: true });
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("expected suggestion");
    expect(result.suggestion.intent).toMatchObject({ intentType: "expense_payment", categoryHint: "rent", amount: 600, currency: "KWD", sourceAccountHint: { id: "bank" } });
    expect(result.suggestion.entry).toMatchObject({ currency: "KWD" });
    expect(result.suggestion.entry.lines).toEqual([
      { accountId: "rent-expense", debit: 600, credit: 0 },
      { accountId: "bank", debit: 0, credit: 600 },
    ]);
    expect(createSuggestedTransaction(result.suggestion).status).toBe("awaiting_approval");
  });

  it("grounds a clear paraphrase and recovers amount, currency, and accounts deterministically", () => {
    expect(parseTransactionIntent(description).status).toBe("unsupported");
    expect(validateTransactionInterpretation(candidate, description)).toMatchObject({
      intentType: "expense_payment", amount: 1200, currency: "SAR", categoryHint: "rent",
      sourceAccountHint: { id: "cash", type: "asset" }, accountHint: { id: "rent-expense", type: "expense" },
    });
  });

  it("rejects fabricated evidence, unsupported classifications, and contradictory accounts", () => {
    expect(validateTransactionInterpretation({ ...candidate, actionEvidence: "Paid office rent" }, description)).toBeUndefined();
    expect(validateTransactionInterpretation({ ...candidate, intentType: "asset_purchase" }, description)).toBeUndefined();
    expect(validateTransactionInterpretation({ ...candidate, accountEvidence: "using bank" }, description)).toBeUndefined();
    expect(validateTransactionInterpretation({ ...candidate, accountEvidence: "using cash", accountRole: "destination" }, description)).toBeUndefined();
  });

  it("never lets a model invent an amount, default a currency, or fill in missing account evidence", () => {
    expect(validateTransactionInterpretation(candidate, "Settled our office rent using cash for SAR")).toBeUndefined();
    expect(validateTransactionInterpretation(candidate, "Settled our office rent using cash for 1200")).toBeUndefined();
    expect(validateTransactionInterpretation({ ...candidate, accountEvidence: null, accountRole: null }, "Settled our office rent for 1,200 SAR")).toBeUndefined();
    expect(validateTransactionInterpretation({ ...candidate, categoryEvidence: null }, description)).toBeUndefined();
  });

  it("clarifies ambiguous amounts, categories, and conflicting bank/cash evidence", () => {
    expect(validateTransactionInterpretation(candidate, "Settled our office rent using cash for 1200 SAR and 10 SAR")).toBeUndefined();
    expect(validateTransactionInterpretation(candidate, "Settled rent and utilities using cash for 1200 SAR")).toBeUndefined();
    expect(validateTransactionInterpretation(candidate, "Settled our office rent using cash or bank for 1200 SAR")).toBeUndefined();
    expect(validateTransactionInterpretation(candidate, "Settled rent using cash and received a utilities invoice unpaid for 1,200 SAR")).toBeUndefined();
  });

  it("runs accepted candidates through the existing suggestion validation without changing a ledger", async () => {
    const request = vi.fn(async () => candidate);
    const result = await routeChatMessage(description, null, vi.fn(), { ...options, requestTransactionInterpreter: request });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ route: "transaction", status: "suggested", assisted: true, text: "AI-assisted draft for review" });
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("expected suggestion");
    expect(result.suggestion.entry).toMatchObject({ id: options.id, date: options.date, currency: "SAR" });
    expect(result.suggestion.entry.lines).toEqual([
      { accountId: "rent-expense", debit: 1200, credit: 0 },
      { accountId: "cash", debit: 0, credit: 1200 },
    ]);
    expect(result.suggestion.intent.description).toBe(description);
    expect(createSuggestedTransaction(result.suggestion).status).toBe("awaiting_approval");
  });

  it("bypasses Ollama for deterministic transactions and falls back to clarification on AI errors", async () => {
    const request = vi.fn(async () => candidate);
    const deterministic = await routeChatMessage("paid rent 600 SAR from bank", null, vi.fn(), { ...options, requestTransactionInterpreter: request });
    expect(deterministic).toMatchObject({ route: "transaction", status: "suggested" });
    expect(request).not.toHaveBeenCalled();

    const arabic = await routeChatMessage("دفعت إيجار 600 د.ك من البنك", null, vi.fn(), { ...options, requestTransactionInterpreter: request });
    expect(arabic).toMatchObject({ route: "transaction", status: "suggested" });
    expect(request).not.toHaveBeenCalled();

    const missingMoney = await routeChatMessage("Settled our office rent using cash", null, vi.fn(), { ...options, requestTransactionInterpreter: request });
    expect(missingMoney).toMatchObject({ route: "transaction", status: "unresolved" });
    expect(request).not.toHaveBeenCalled();

    const missingCurrency = await routeChatMessage("Paid office rent of 600 from the bank account", null, vi.fn(), { ...options, requestTransactionInterpreter: request });
    expect(missingCurrency).toMatchObject({ route: "transaction" });
    expect(request).not.toHaveBeenCalled();

    const missingSource = await routeChatMessage("Paid office rent of 600 KWD", null, vi.fn(), {
      ...options,
      requestTransactionInterpreter: async () => ({ ...officeRentCandidate, accountEvidence: null, accountRole: null }),
    });
    expect(missingSource).toMatchObject({ route: "transaction", status: "unresolved", text: "Which account did you pay from: Bank or Cash?" });

    const extraClause = await routeChatMessage("Paid office rent of 600 KWD from the bank account and donated to charity", null, vi.fn(), {
      ...options,
      requestTransactionInterpreter: async () => officeRentCandidate,
    });
    expect(extraClause).toMatchObject({ route: "transaction", status: "unsupported" });

    const unavailable = await routeChatMessage(description, null, vi.fn(), { ...options, requestTransactionInterpreter: async () => { throw new Error("offline"); } });
    expect(unavailable).toMatchObject({ route: "transaction", status: "unsupported" });
    const malformed = await routeChatMessage(description, null, vi.fn(), { ...options, requestTransactionInterpreter: async () => ({ ...candidate, amount: 999999 }) });
    expect(malformed).toMatchObject({ route: "transaction", status: "unsupported" });
    const malformedShape = await routeChatMessage(description, null, vi.fn(), { ...options, requestTransactionInterpreter: async () => "not a candidate" });
    expect(malformedShape).toMatchObject({ route: "transaction", status: "unsupported" });
  });

  it("handles customer service receipts with an explicitly grounded destination account", () => {
    const text = "Collected payment for consulting services into bank, 500 SAR";
    const receipt: TransactionInterpretationCandidate = {
      intentType: "revenue_receipt", actionEvidence: "Collected payment for consulting services",
      categoryEvidence: "consulting services", accountEvidence: "into bank", accountRole: "destination",
    };
    expect(validateTransactionInterpretation(receipt, text)).toMatchObject({
      intentType: "revenue_receipt", amount: 500, currency: "SAR", categoryHint: "services",
      destinationAccountHint: { id: "bank", type: "asset" },
    });
  });

  it("supports only explicitly evidenced accrual, asset, and owner-investment paraphrases", () => {
    const invoiceText = "Received utilities invoice unpaid for 80 USD";
    expect(validateTransactionInterpretation({
      intentType: "expense_on_account", actionEvidence: "Received utilities invoice unpaid", categoryEvidence: "utilities",
      accountEvidence: null, accountRole: null,
    }, invoiceText)).toMatchObject({ intentType: "expense_on_account", categoryHint: "utilities" });

    const saleText = "Provided services to a client on account for 500 SAR";
    expect(validateTransactionInterpretation({
      intentType: "revenue_on_account", actionEvidence: "Provided services to a client on account", categoryEvidence: "services",
      accountEvidence: null, accountRole: null,
    }, saleText)).toMatchObject({ intentType: "revenue_on_account", categoryHint: "services" });

    const assetText = "Acquired a laptop using bank for 900 USD";
    expect(validateTransactionInterpretation({
      intentType: "asset_purchase", actionEvidence: "Acquired a laptop", categoryEvidence: "laptop",
      accountEvidence: "using bank", accountRole: "source",
    }, assetText)).toMatchObject({ intentType: "asset_purchase", accountHint: { id: "computer-equipment" }, sourceAccountHint: { id: "bank" } });

    const investmentText = "Owner contributed capital into the bank account for 2,000 SAR";
    expect(validateTransactionInterpretation({
      intentType: "owner_investment", actionEvidence: "Owner contributed capital into the bank account", categoryEvidence: null,
      accountEvidence: "bank account", accountRole: "destination",
    }, investmentText)).toMatchObject({ intentType: "owner_investment", accountHint: { id: "owners-equity" }, destinationAccountHint: { id: "bank" } });
  });
});
