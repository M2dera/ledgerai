import { DEFAULT_CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import { parseTransactionIntent, type TransactionAccountHint, type TransactionIntent, type TransactionIntentIssue, type TransactionIntentType } from "./transaction-intent";

/** The model can classify language and quote it, but cannot supply accounting values. */
export type TransactionInterpretationCandidate = {
  intentType: TransactionIntentType;
  actionEvidence: string;
  categoryEvidence: string | null;
  accountEvidence: string | null;
  accountRole: "source" | "destination" | null;
};

const INTENTS: readonly TransactionIntentType[] = ["expense_payment", "expense_on_account", "revenue_receipt", "revenue_on_account", "asset_purchase", "owner_investment"];
const EXPENSE_CATEGORIES = [
  { value: "rent", pattern: /\b(?:rent|rental|lease)\b/i },
  { value: "salaries", pattern: /\b(?:salary|salaries|payroll|wages?)\b/i },
  { value: "utilities", pattern: /\b(?:utilities|utility|electric(?:ity)?|water bill)\b/i },
  { value: "services", pattern: /\b(?:services?|consulting|consultancy)\b/i },
  { value: "laptop", pattern: /\b(?:laptop|notebook computer)\b/i },
  { value: "computer", pattern: /\b(?:computer|desktop)\b/i },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/\s+/g, " ").trim();
}

function evidenceOccurs(source: string, evidence: string): boolean {
  return evidence.length > 0 && evidence.length <= 180 && normalize(source).includes(normalize(evidence));
}

function actionSupports(intent: TransactionIntentType, evidence: string): boolean {
  const text = normalize(evidence);
  const expressions: Record<TransactionIntentType, RegExp> = {
    expense_payment: /\b(?:paid|settled|covered|paid off)\b/i,
    expense_on_account: /\b(?:received|got)\b.{0,45}\binvoice\b|\binvoice\b.{0,45}\b(?:unpaid|due|on account)\b/i,
    revenue_receipt: /\b(?:received|collected|got)\b/i,
    revenue_on_account: /\b(?:sold|provided|delivered)\b/i,
    asset_purchase: /\b(?:bought|purchased|acquired)\b/i,
    owner_investment: /\b(?:invested|injected|contributed)\b/i,
  };
  if (!expressions[intent].test(text)) return false;
  if ((intent === "expense_payment" || intent === "asset_purchase") && /\b(?:unpaid|not paid|on account|due)\b/i.test(text)) return false;
  if ((intent === "expense_on_account" || intent === "revenue_on_account") && !/\b(?:unpaid|not paid|not received|on account|due|credit)\b/i.test(text)) return false;
  if (intent === "expense_payment") return /\b(?:rent|rental|lease|salary|salaries|payroll|wages?|utilities|utility|electric(?:ity)?|water bill)\b/i.test(text);
  if (intent === "expense_on_account") return /\b(?:rent|rental|lease|salary|salaries|payroll|wages?|utilities|utility|electric(?:ity)?|water bill)\b/i.test(text);
  if (intent === "revenue_receipt") return /\b(?:service|services|consulting|consultancy)\b/i.test(text) && /\b(?:payment|customer|client|collected)\b/i.test(text);
  if (intent === "revenue_on_account") return /\b(?:service|services|consulting|consultancy)\b/i.test(text) && /\b(?:customer|client)\b/i.test(text);
  if (intent === "asset_purchase") return /\b(?:laptop|notebook computer|computer|desktop)\b/i.test(text);
  return /\b(?:owner|owner's|capital|company)\b/i.test(text);
}

function classifySupportedActions(description: string): TransactionIntentType[] {
  const text = normalize(description);
  const expense = /\b(?:rent|rental|lease|salary|salaries|payroll|wages?|utilities|utility|electric(?:ity)?|water bill)\b/i.test(text);
  const service = /\b(?:service|services|consulting|consultancy)\b/i.test(text);
  const asset = /\b(?:laptop|notebook computer|computer|desktop)\b/i.test(text);
  const onAccount = /\b(?:unpaid|not paid|not received|on account|due|credit)\b/i.test(text);
  const signals: TransactionIntentType[] = [];
  if (/\b(?:received|got)\b.{0,45}\binvoice\b/i.test(text) && expense && onAccount) signals.push("expense_on_account");
  if (/\b(?:sold|provided|delivered)\b/i.test(text) && service && /\b(?:customer|client)\b/i.test(text) && onAccount) signals.push("revenue_on_account");
  if (/\b(?:bought|purchased|acquired)\b/i.test(text) && asset) signals.push("asset_purchase");
  if (/\b(?:invested|injected|contributed)\b/i.test(text) && /\b(?:owner|owner's|capital|company)\b/i.test(text)) signals.push("owner_investment");
  if (/\b(?:received|collected|got)\b/i.test(text) && service && !/\binvoice\b/i.test(text) &&
      (/\b(?:payment|customer|client|collected)\b/i.test(text))) signals.push("revenue_receipt");
  if (/\b(?:paid|settled|covered)\b/i.test(text) && expense && !onAccount) signals.push("expense_payment");
  return signals;
}

const ALLOWED_TRANSACTION_WORDS = new Set([
  "paid", "settled", "covered", "received", "got", "collected", "sold", "provided", "delivered", "bought", "purchased", "acquired", "invested", "injected", "contributed",
  "rent", "rental", "lease", "office", "salary", "salaries", "payroll", "wage", "wages", "utilities", "utility", "electric", "electricity", "water", "bill",
  "service", "services", "consulting", "consultancy", "laptop", "notebook", "computer", "desktop", "invoice", "unpaid", "due", "credit", "account", "bank", "cash",
  "owner", "owners", "capital", "company", "customer", "client", "payment", "we", "i", "our", "the", "a", "an", "of", "for", "from", "into", "to", "in", "on", "not", "with", "using", "through", "via",
  "kwd", "kd", "sar", "aed", "usd", "eur", "gbp", "cad", "aud", "jpy",
]);

function hasOnlySupportedWording(description: string): boolean {
  const words = normalize(description).match(/[a-z]+/g) ?? [];
  return words.every((word) => ALLOWED_TRANSACTION_WORDS.has(word)) &&
    !/\b(?:and|then|but|while|also)\b/i.test(description);
}

function explicitSettlementAccounts(description: string): Array<{ account: "bank" | "cash"; role: "source" | "destination" }> {
  const text = normalize(description);
  const matches: Array<{ account: "bank" | "cash"; role: "source" | "destination" }> = [];
  for (const match of text.matchAll(/\b(?:from|using|through|via|with)\s+(?:the\s+)?(bank|cash)(?:\s+account)?\b/g)) {
    matches.push({ account: match[1] as "bank" | "cash", role: "source" });
  }
  for (const match of text.matchAll(/\b(?:into|to|in)\s+(?:the\s+)?(bank|cash)(?:\s+account)?\b/g)) {
    matches.push({ account: match[1] as "bank" | "cash", role: "destination" });
  }
  return matches;
}

function classifyCategory(evidence: string): TransactionIntent["categoryHint"] | undefined {
  const found = EXPENSE_CATEGORIES.filter(({ pattern }) => pattern.test(evidence));
  if (found.length !== 1) return undefined;
  return found[0].value;
}

function chartHint(id: string): TransactionAccountHint | undefined {
  const account = DEFAULT_CHART_OF_ACCOUNTS.find((entry) => entry.id === id);
  return account ? { id: account.id, type: account.type } : undefined;
}

/** Returns a complete existing TransactionIntent only when all quotes and explicit facts validate. */
export function validateTransactionInterpretation(
  value: unknown,
  description: string,
): TransactionIntent | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "accountEvidence,accountRole,actionEvidence,categoryEvidence,intentType" ||
      !INTENTS.includes(value.intentType as TransactionIntentType) || typeof value.actionEvidence !== "string" ||
      !(value.categoryEvidence === null || typeof value.categoryEvidence === "string") ||
      !(value.accountEvidence === null || typeof value.accountEvidence === "string") ||
      !(value.accountRole === null || value.accountRole === "source" || value.accountRole === "destination")) return undefined;
  if (description.length > 1000 || !hasOnlySupportedWording(description) || !evidenceOccurs(description, value.actionEvidence)) return undefined;
  const intentType = value.intentType as TransactionIntentType;
  if (!actionSupports(intentType, value.actionEvidence)) return undefined;
  const actionSignals = classifySupportedActions(description);
  if (actionSignals.length !== 1 || actionSignals[0] !== intentType) return undefined;

  // Amount and currency are exclusively recovered by the deterministic parser.
  const parsed = parseTransactionIntent(description);
  if (parsed.intent.amount === undefined || parsed.intent.currency === undefined ||
      parsed.issues.some(({ code }) => ["MISSING_AMOUNT", "INVALID_AMOUNT", "AMBIGUOUS_AMOUNT", "MISSING_CURRENCY", "AMBIGUOUS_CURRENCY"].includes(code))) return undefined;

  const categoryRequired = intentType !== "owner_investment";
  let categoryHint: TransactionIntent["categoryHint"];
  if (categoryRequired) {
    if (typeof value.categoryEvidence !== "string" || !evidenceOccurs(description, value.categoryEvidence) || !evidenceOccurs(value.actionEvidence, value.categoryEvidence)) return undefined;
    categoryHint = classifyCategory(value.categoryEvidence);
    if (!categoryHint) return undefined;
    const allCategoryMentions = EXPENSE_CATEGORIES.filter(({ pattern }) => pattern.test(description));
    if (allCategoryMentions.length !== 1) return undefined;
    const expectedType = intentType === "expense_payment" || intentType === "expense_on_account" ? ["rent", "salaries", "utilities"]
      : intentType === "asset_purchase" ? ["laptop", "computer"] : ["services"];
    if (!expectedType.includes(categoryHint)) return undefined;
  } else if (value.categoryEvidence !== null) return undefined;

  const outgoing = intentType === "expense_payment" || intentType === "asset_purchase";
  const incoming = intentType === "revenue_receipt" || intentType === "owner_investment";
  let sourceAccountHint: TransactionAccountHint | undefined;
  let destinationAccountHint: TransactionAccountHint | undefined;
  const settlementAccounts = explicitSettlementAccounts(description);
  if (outgoing || incoming) {
    const requiredRole = outgoing ? "source" : "destination";
    if (value.accountRole !== requiredRole || typeof value.accountEvidence !== "string" || !evidenceOccurs(description, value.accountEvidence)) return undefined;
    const evidence = normalize(value.accountEvidence);
    const bank = /\bbank\b/.test(evidence);
    const cash = /\bcash\b/.test(evidence);
    if (bank === cash) return undefined;
    if (settlementAccounts.length !== 1 || settlementAccounts[0].role !== requiredRole ||
        settlementAccounts[0].account !== (bank ? "bank" : "cash") ||
        (bank && /\bcash\b/.test(description)) || (cash && /\bbank\b/.test(description))) return undefined;
    const hint = chartHint(bank ? "bank" : "cash");
    if (!hint) return undefined;
    if (outgoing) sourceAccountHint = hint;
    else destinationAccountHint = hint;
  } else if (value.accountEvidence !== null || value.accountRole !== null || settlementAccounts.length > 0) return undefined;

  // Mismatched or contradictory action evidence is never resolved by the model's label.
  const actionText = normalize(description);
  if ((intentType === "expense_payment" && /\b(?:sold|provided|invested|injected)\b/.test(actionText)) ||
      (intentType === "revenue_receipt" && /\b(?:paid|settled|bought|purchased|invested)\b/.test(actionText)) ||
      (intentType === "owner_investment" && /\b(?:paid|sold|bought|purchased)\b/.test(actionText)) ||
      (intentType === "asset_purchase" && /\b(?:paid|sold|invested)\b/.test(actionText)) ||
      (intentType.endsWith("on_account") && /\b(?:from|using|via|through|with|into|to|in)\s+(?:the\s+)?(?:bank|cash)\b/.test(actionText))) return undefined;

  const accountHint = intentType === "owner_investment" ? chartHint("owners-equity")
    : intentType === "asset_purchase" ? chartHint("computer-equipment")
      : intentType === "expense_payment" || intentType === "expense_on_account"
        ? chartHint(({ rent: "rent-expense", salaries: "salaries-expense", utilities: "utilities-expense" } as const)[categoryHint as "rent" | "salaries" | "utilities"])
        : chartHint("revenue");
  if (!accountHint) return undefined;
  return {
    intentType,
    amount: parsed.intent.amount,
    currency: parsed.intent.currency,
    description,
    ...(categoryHint ? { categoryHint } : {}),
    accountHint,
    ...(sourceAccountHint ? { sourceAccountHint } : {}),
    ...(destinationAccountHint ? { destinationAccountHint } : {}),
  };
}

/** A grounded candidate can identify a missing settlement detail without resolving it. */
export function getMissingSettlementClarification(value: unknown, description: string): TransactionIntentIssue | undefined {
  if (!isRecord(value) || typeof value.intentType !== "string" || typeof value.actionEvidence !== "string" ||
      Object.keys(value).sort().join(",") !== "accountEvidence,accountRole,actionEvidence,categoryEvidence,intentType" ||
      !(value.categoryEvidence === null || typeof value.categoryEvidence === "string") ||
      value.accountEvidence !== null || value.accountRole !== null || !hasOnlySupportedWording(description) ||
      !evidenceOccurs(description, value.actionEvidence)) return undefined;
  const intentType = value.intentType as TransactionIntentType;
  const paymentFrom = intentType === "expense_payment" || intentType === "asset_purchase";
  const paymentTo = intentType === "revenue_receipt" || intentType === "owner_investment";
  if ((!paymentFrom && !paymentTo) || !INTENTS.includes(intentType) || !actionSupports(intentType, value.actionEvidence) ||
      classifySupportedActions(description).join(",") !== intentType) return undefined;
  if (intentType !== "owner_investment") {
    if (typeof value.categoryEvidence !== "string" || !evidenceOccurs(value.actionEvidence, value.categoryEvidence)) return undefined;
    const category = classifyCategory(value.categoryEvidence);
    const expected = intentType === "expense_payment" ? ["rent", "salaries", "utilities"]
      : intentType === "asset_purchase" ? ["laptop", "computer"] : ["services"];
    if (!category || !expected.includes(category) || EXPENSE_CATEGORIES.filter(({ pattern }) => pattern.test(description)).length !== 1) return undefined;
  }
  const parsed = parseTransactionIntent(description);
  if (parsed.intent.amount === undefined || parsed.intent.currency === undefined ||
      parsed.issues.some(({ code }) => ["MISSING_AMOUNT", "INVALID_AMOUNT", "AMBIGUOUS_AMOUNT", "MISSING_CURRENCY", "AMBIGUOUS_CURRENCY"].includes(code))) return undefined;
  if (/(?:bank|cash)/i.test(description)) return undefined;
  return paymentFrom
    ? { code: "MISSING_SOURCE_ACCOUNT", message: "Which account did you pay from: Bank or Cash?" }
    : { code: "MISSING_DESTINATION_ACCOUNT", message: "Which account received the amount: Bank or Cash?" };
}
