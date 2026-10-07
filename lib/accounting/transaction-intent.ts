import { detectFinancialUnit } from "../financial/unit";
import { DEFAULT_CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import type { Account, JournalEntry } from "./types";

export const TRANSACTION_INTENT_TYPES = [
  "expense_payment",
  "expense_on_account",
  "revenue_receipt",
  "revenue_on_account",
  "asset_purchase",
  "owner_investment",
] as const;

export type TransactionIntentType = (typeof TRANSACTION_INTENT_TYPES)[number];
export type TransactionAccountHint = Pick<Account, "id" | "type">;
export type TransactionCategoryHint = "rent" | "salaries" | "utilities" | "services" | "laptop" | "computer";

/** Hints are evidence for later account selection, never journal entry lines. */
export type TransactionIntent = {
  intentType: TransactionIntentType;
  amount: number;
  currency: JournalEntry["currency"];
  description: string;
  categoryHint?: TransactionCategoryHint;
  accountHint?: TransactionAccountHint;
  sourceAccountHint?: TransactionAccountHint;
  destinationAccountHint?: TransactionAccountHint;
  counterparty?: { role: "customer" | "supplier"; name?: string };
};

export type PartialTransactionIntent = Partial<TransactionIntent> & Pick<TransactionIntent, "description">;

export type TransactionIntentIssueCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_TEXT"
  | "MISSING_AMOUNT"
  | "INVALID_AMOUNT"
  | "AMBIGUOUS_AMOUNT"
  | "MISSING_CURRENCY"
  | "AMBIGUOUS_CURRENCY"
  | "MISSING_CATEGORY"
  | "AMBIGUOUS_CATEGORY"
  | "MISSING_SOURCE_ACCOUNT"
  | "MISSING_DESTINATION_ACCOUNT"
  | "AMBIGUOUS_ACCOUNT"
  | "ASSET_ACCOUNT_REQUIRED"
  | "REVENUE_CONTEXT_REQUIRED";

export type TransactionIntentIssue = { code: TransactionIntentIssueCode; message: string };
export type TransactionIntentResult =
  | { status: "resolved"; intent: TransactionIntent; issues: [] }
  | {
      status: "unresolved" | "unsupported";
      intent: PartialTransactionIntent;
      issues: [TransactionIntentIssue, ...TransactionIntentIssue[]];
    };

const EXPENSE_AR = "(?:ال)?(?:ايجار|راتب|رواتب|اجور|كهرباء|ماي|ماء|مياه|خدمات)";
const EXPENSE_EN = "(?:rent|salary|salaries|payroll|wage|wages|electricity|water|utility|utilities)";
const SERVICE_AR = "(?:ال)?(?:خدمة|خدمه|خدمات)";
const SERVICE_EN = "services?";
const ASSET_AR = "(?:ال)?(?:لابتوب|حاسوب)";
const ASSET_EN = "(?:laptop|computer)";
const ACCOUNT_AR = "(?:البنك|بنك|الكاش|كاش|الصندوق|صندوق)";
const ACCOUNT_EN = "(?:bank|cash)";
const MONEY = "(?:@amount(?: ?@currency)?|@currency ?@amount)";
const CUSTOMER_AR = "(?<counterparty>العميل|عميل)(?: @name)?";
const SUPPLIER_AR = "(?<counterparty>المورد|مورد)(?: @name)?";
const TO_CUSTOMER_AR = "(?:لل|ل)(?<counterparty>عميل)(?: @name)?";
const TO_SUPPLIER_AR = "(?:لل|ل)(?<counterparty>مورد)(?: @name)?";
const CUSTOMER_EN = "(?:the |a )?(?<counterparty>customer)(?: @name)?";
const SUPPLIER_EN = "(?:the |a )?(?<counterparty>supplier)(?: @name)?";
const SOURCE_AR = `(?: من (?<source>${ACCOUNT_AR}))?`;
const SOURCE_EN = `(?: from (?:the )?(?<source>${ACCOUNT_EN}))?`;
const DESTINATION_AR = `(?: (?:في|الى) (?<destination>${ACCOUNT_AR}))?`;
const DESTINATION_EN = `(?: (?:into|to) (?:the )?(?<destination>${ACCOUNT_EN}))?`;
const UNPAID_AR = "(?:وما دفعتها|وما دفعناها|ولم ادفعها|على الحساب)";
const UNRECEIVED_AR = "(?:وما استلمت المبلغ|وما استلمنا المبلغ|ولم استلم المبلغ|على الحساب)";
const UNPAID_EN = "(?:and )?(?:unpaid|not paid|on account)";
const UNRECEIVED_EN = "(?:and )?(?:unpaid|not received|on account)";

type Rule = { intentType: TransactionIntentType; pattern: RegExp };
const rule = (intentType: TransactionIntentType, pattern: string): Rule => ({
  intentType,
  pattern: new RegExp(`^${pattern}$`, "u"),
});

// Each rule consumes the entire statement. Unrecognized qualifiers are not discarded.
const RULES: readonly Rule[] = [
  rule("expense_payment", `(?:دفعت|دفعنا) (?:(?<category>${EXPENSE_AR}) )?${MONEY}${SOURCE_AR}(?: ${TO_SUPPLIER_AR})?`),
  rule("expense_payment", `(?:paid|we paid) (?:(?<category>${EXPENSE_EN}) )?${MONEY}${SOURCE_EN}(?: to ${SUPPLIER_EN})?`),
  rule("expense_on_account", `(?:استلمت|استلمنا) (?:فاتورة|فاتوره) (?:(?<category>${EXPENSE_AR}) )?${MONEY}(?: من ${SUPPLIER_AR})? ${UNPAID_AR}`),
  rule("expense_on_account", `(?:received|we received) (?:an? )?(?:(?<category>${EXPENSE_EN}) )?invoice (?:for )?${MONEY}(?: from ${SUPPLIER_EN})? ${UNPAID_EN}`),
  rule("revenue_receipt", `(?:استلمت|استلمنا) من ${CUSTOMER_AR} ${MONEY}(?: مقابل (?<category>${SERVICE_AR}))?${DESTINATION_AR}`),
  rule("revenue_receipt", `(?:استلمت|استلمنا) من ${CUSTOMER_AR} ${MONEY}${DESTINATION_AR}(?: مقابل (?<category>${SERVICE_AR}))?`),
  rule("revenue_receipt", `(?:received|we received) ${MONEY} from ${CUSTOMER_EN}(?: for (?<category>${SERVICE_EN}))?${DESTINATION_EN}`),
  rule("revenue_receipt", `(?:received|we received) ${MONEY} from ${CUSTOMER_EN}${DESTINATION_EN}(?: for (?<category>${SERVICE_EN}))?`),
  rule("revenue_receipt", `(?:received|we received) from ${CUSTOMER_EN} ${MONEY}(?: for (?<category>${SERVICE_EN}))?${DESTINATION_EN}`),
  rule("revenue_on_account", `(?:بعت|بعنا) ${TO_CUSTOMER_AR} (?:(?<category>${SERVICE_AR}) )?(?:ب ?|بمبلغ )?${MONEY} ${UNRECEIVED_AR}`),
  rule("revenue_on_account", `(?:sold|we sold) (?:a )?(?:(?<category>${SERVICE_EN}) )?to ${CUSTOMER_EN} (?:for )?${MONEY} ${UNRECEIVED_EN}`),
  rule("asset_purchase", `(?:شريت|اشتريت) (?:(?<category>${ASSET_AR}) )?(?:ب ?|بمبلغ )?${MONEY}${SOURCE_AR}(?: من ${SUPPLIER_AR})?`),
  rule("asset_purchase", `(?:bought|we bought|purchased) (?:a )?(?:(?<category>${ASSET_EN}) )?(?:for )?${MONEY}${SOURCE_EN}(?: from ${SUPPLIER_EN})?`),
  rule("owner_investment", `(?:ضخت|ضخيت|استثمرت) ${MONEY} في (?:الشركة|الشركه|شركة|شركه)${DESTINATION_AR}`),
  rule("owner_investment", `(?:invested|we invested|injected) ${MONEY} into (?:the )?company${DESTINATION_EN}`),
];

// The unit detector remains the authority for currency identity/symbol ambiguity.
const CURRENCY_TOKEN = /(?<![\p{L}\p{N}])(?:kwd|kd|sar|aed|usd|eur|gbp|cad|aud|jpy|د\s*\.?\s*ك\.?|دينار كويتي|ر\s*\.?\s*س\.?|ريال سعودي|[$€£¥])(?![\p{L}\p{N}])/gu;
const AMOUNT_TOKEN = /(?<![\p{L}\p{N}])[+-]?\d[\d,.]*(?![\p{L}\p{N}])/gu;

function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٬/g, ",").replace(/٫/g, ".")
    .replace(/(^|\s)ب(?=\d)/g, "$1ب ")
    .replace(/\s+/g, " ").trim();
}

function parseAmount(token: string): number | undefined {
  if (!/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,3})?$/.test(token)) return undefined;
  const numericText = token.replace(/,/g, "");
  const amount = Number(numericText);
  const [integer, fraction = ""] = numericText.split(".");
  const canonical = `${integer.replace(/^0+(?=\d)/, "")}${fraction ? `.${fraction}` : ""}`;
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER ||
      amount.toFixed(fraction.length) !== canonical) return undefined;
  return amount;
}

function accountHint(id: (typeof DEFAULT_CHART_OF_ACCOUNTS)[number]["id"]): TransactionAccountHint {
  const account = DEFAULT_CHART_OF_ACCOUNTS.find((candidate) => candidate.id === id)!;
  return { id: account.id, type: account.type };
}

function moneyAccount(token: string): TransactionAccountHint {
  return accountHint(/bank|بنك/.test(token) ? "bank" : "cash");
}

function expenseCategory(token: string): "rent" | "salaries" | "utilities" {
  if (/rent|ايجار/.test(token)) return "rent";
  if (/salary|salaries|payroll|wage|راتب|رواتب|اجور/.test(token)) return "salaries";
  return "utilities";
}

function issue(code: TransactionIntentIssueCode, message: string): TransactionIntentIssue {
  return { code, message };
}

function incomplete(
  status: "unresolved" | "unsupported",
  intent: PartialTransactionIntent,
  issues: TransactionIntentIssue[],
): TransactionIntentResult {
  return { status, intent, issues: [issues[0], ...issues.slice(1)] };
}

/**
 * Deterministic v1 grammar; see docs/transaction-intent-v1.md for supported clauses.
 * No account selection outside the existing chart, side effects, or journal entries.
 */
export function parseTransactionIntent(description: unknown): TransactionIntentResult {
  if (typeof description !== "string" || !description.trim() || description.length > 1000) {
    return incomplete("unsupported", { description: typeof description === "string" ? description : "" }, [
      issue("INVALID_INPUT", "Expected a nonempty transaction description of at most 1,000 characters."),
    ]);
  }

  const intent: PartialTransactionIntent = { description };
  const issues: TransactionIntentIssue[] = [];
  const names = [...description.matchAll(/"([^"\r\n]{1,80})"/g)];
  if (names.length > 1 || names.some((name) => !name[1].trim()) || description.normalize("NFKC").includes("@")) {
    return incomplete("unsupported", intent, [issue("UNSUPPORTED_TEXT", "Only one nonempty quoted counterparty name is supported; internal markers are not input syntax.")]);
  }
  let text = normalizeText(description.replace(/"([^"\r\n]{1,80})"/g, "@name"));
  if (!/^(?:دفعت|دفعنا|استلمت|استلمنا|بعت|بعنا|شريت|اشتريت|ضخت|ضخيت|استثمرت|paid|we paid|received|we received|sold|we sold|bought|we bought|purchased|invested|we invested|injected)(?: |$)/u.test(text)) {
    return incomplete("unsupported", intent, [issue("UNSUPPORTED_TEXT", "The statement must begin with a supported completed transaction action.")]);
  }
  const amounts = [...text.matchAll(AMOUNT_TOKEN)];
  const currencies = [...text.matchAll(CURRENCY_TOKEN)];

  if (amounts.length === 0) {
    issues.push(issue("MISSING_AMOUNT", "A numeric transaction amount is required."));
  } else if (amounts.length > 1) {
    issues.push(issue("AMBIGUOUS_AMOUNT", "More than one amount is present; v1 supports one transaction amount."));
  } else {
    intent.amount = parseAmount(amounts[0][0]);
    if (intent.amount === undefined) {
      delete intent.amount;
      issues.push(issue("INVALID_AMOUNT", "Use a positive, safely representable amount with valid thousands grouping and at most three decimal places."));
    }
  }

  if (currencies.length === 0) {
    issues.push(issue("MISSING_CURRENCY", "Currency must be explicitly stated using a supported marker."));
  } else if (currencies.length > 1) {
    issues.push(issue("AMBIGUOUS_CURRENCY", "More than one currency marker is present; no currency was selected."));
  } else {
    const unit = detectFinancialUnit([], [currencies[0][0]]);
    if (unit.status === "known" && unit.code) intent.currency = unit.code;
    else issues.push(issue("AMBIGUOUS_CURRENCY", "The currency symbol does not identify a single currency."));
  }

  // With invalid/multiple amounts or currencies, no grammatical/account interpretation is safe.
  if (intent.amount === undefined || amounts.length > 1 || currencies.length > 1) {
    return incomplete("unresolved", intent, issues);
  }
  text = text.replace(AMOUNT_TOKEN, "@amount").replace(CURRENCY_TOKEN, "@currency")
    .replace(/[.!]+$/u, "").trim();
  const matched = RULES.map((candidate) => ({ ...candidate, match: candidate.pattern.exec(text) }))
    .find((candidate) => candidate.match);
  if (!matched?.match) {
    // Conflicting hints stay absent even when they use otherwise supported words.
    const accountConflict = /(?:bank|cash|البنك|بنك|الكاش|كاش|الصندوق|صندوق) (?:or |and |او |و ?)(?:bank|cash|البنك|بنك|الكاش|كاش|الصندوق|صندوق)/u.test(text);
    const categoryConflict = new RegExp(`(?:${EXPENSE_AR}|${EXPENSE_EN}) (?:or |and |او |و ?)(?:${EXPENSE_AR}|${EXPENSE_EN})`, "u").test(text);
    if (accountConflict || categoryConflict) {
      if (accountConflict) issues.push(issue("AMBIGUOUS_ACCOUNT", "Conflicting payment account hints require clarification."));
      if (categoryConflict) issues.push(issue("AMBIGUOUS_CATEGORY", "Multiple expense categories require clarification."));
      return incomplete("unresolved", intent, issues);
    }
    issues.push(issue("UNSUPPORTED_TEXT", "The whole statement must match one supported transaction clause; qualifiers and extra clauses are not inferred."));
    return incomplete("unsupported", intent, issues);
  }

  intent.intentType = matched.intentType;
  const { category, source, destination, counterparty } = matched.match.groups ?? {};
  if (source) intent.sourceAccountHint = moneyAccount(source);
  if (destination) intent.destinationAccountHint = moneyAccount(destination);
  if (counterparty) {
    intent.counterparty = {
      role: /customer|عميل/.test(counterparty) ? "customer" : "supplier",
      ...(names.length ? { name: names[0][1].trim() } : {}),
    };
  }

  if (matched.intentType === "expense_payment" || matched.intentType === "expense_on_account") {
    if (category) {
      intent.categoryHint = expenseCategory(category);
      const accountId = { rent: "rent-expense", salaries: "salaries-expense", utilities: "utilities-expense" } as const;
      intent.accountHint = accountHint(accountId[intent.categoryHint]);
    } else issues.push(issue("MISSING_CATEGORY", "An explicit supported expense category is required."));
  } else if (matched.intentType === "asset_purchase") {
    if (category) {
      intent.categoryHint = /computer|حاسوب/.test(category) ? "computer" : "laptop";
      intent.accountHint = accountHint("computer-equipment");
    } else {
      issues.push(issue("MISSING_CATEGORY", "An explicit supported asset category is required."));
      issues.push(issue("ASSET_ACCOUNT_REQUIRED", "An asset account cannot be selected without an explicit supported asset category."));
    }
  } else if (matched.intentType === "owner_investment") {
    intent.accountHint = accountHint("owners-equity");
  } else if (category) {
    intent.categoryHint = "services";
    intent.accountHint = accountHint("revenue");
  } else {
    issues.push(issue("REVENUE_CONTEXT_REQUIRED", "A customer receipt or sale without explicit services cannot establish a revenue account; receivable settlements and advances are not inferred."));
  }

  if ((matched.intentType === "expense_payment" || matched.intentType === "asset_purchase") && !source) {
    issues.push(issue("MISSING_SOURCE_ACCOUNT", "The payment source must be explicitly stated; bank or cash is not assumed."));
  }
  if ((matched.intentType === "revenue_receipt" || matched.intentType === "owner_investment") && !destination) {
    issues.push(issue("MISSING_DESTINATION_ACCOUNT", "The receiving account must be explicitly stated; bank or cash is not assumed."));
  }
  if (issues.length) return incomplete("unresolved", intent, issues);
  // Every resolved path has a supported type, one validated amount, and one known currency.
  return { status: "resolved", intent: intent as TransactionIntent, issues: [] };
}
