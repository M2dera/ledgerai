import { DEFAULT_CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import { TRANSACTION_INTENT_TYPES, type TransactionAccountHint, type TransactionIntent } from "./transaction-intent";
import type { Account, AccountType, JournalEntry, JournalEntryValidationError } from "./types";
import { validateJournalEntry } from "./validation";

/** A validated proposal with its original evidence. Creating one never posts an entry. */
export type SuggestedJournalEntry = {
  entry: JournalEntry;
  intent: TransactionIntent;
};

export type SuggestedJournalEntryOptions = Pick<JournalEntry, "id" | "date"> & {
  accounts?: readonly Account[];
};

export type SuggestedJournalEntryIssueCode =
  | "INVALID_INTENT"
  | "UNSUPPORTED_INTENT"
  | "INVALID_AMOUNT"
  | "MISSING_CURRENCY"
  | "INVALID_CURRENCY"
  | "MISSING_CATEGORY"
  | "UNSUPPORTED_CATEGORY"
  | "MISSING_ACCOUNT_HINT"
  | "MISSING_SOURCE_ACCOUNT"
  | "MISSING_DESTINATION_ACCOUNT"
  | "UNSUPPORTED_ACCOUNT"
  | "ACCOUNT_HINT_CONFLICT"
  | "ACCOUNT_NOT_FOUND"
  | "AMBIGUOUS_ACCOUNT"
  | "ACCOUNT_TYPE_MISMATCH"
  | "CONFLICTING_ACCOUNT_EVIDENCE"
  | "INVALID_ACCOUNT_CHART"
  | "MISSING_ENTRY_ID"
  | "INVALID_ENTRY_DATE"
  | "ACCOUNTING_VALIDATION_FAILED";

export type SuggestedJournalEntryIssue = {
  code: SuggestedJournalEntryIssueCode;
  message: string;
  validationErrors?: JournalEntryValidationError[];
};

export type SuggestedJournalEntryResult =
  | { status: "suggested"; suggestion: SuggestedJournalEntry; issues: [] }
  | {
      status: "unresolved" | "rejected";
      intent: TransactionIntent;
      issues: [SuggestedJournalEntryIssue, ...SuggestedJournalEntryIssue[]];
    };

const EXPENSE_ACCOUNTS = {
  rent: "rent-expense",
  salaries: "salaries-expense",
  utilities: "utilities-expense",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

/**
 * Maps structured evidence only. Entry ID/date come from the caller, never a clock or UUID.
 * The selected chart must contain each exact supported account once, with the expected type.
 */
export function suggestJournalEntry(
  intent: TransactionIntent,
  options: SuggestedJournalEntryOptions,
): SuggestedJournalEntryResult {
  const issues: SuggestedJournalEntryIssue[] = [];
  let rejected = false;
  const addIssue = (code: SuggestedJournalEntryIssueCode, message: string, reject = true) => {
    issues.push({ code, message });
    rejected ||= reject;
  };
  const failure = (): SuggestedJournalEntryResult => ({
    status: rejected ? "rejected" : "unresolved",
    intent,
    issues: [issues[0], ...issues.slice(1)],
  });

  if (!isRecord(intent)) {
    addIssue("INVALID_INTENT", "Expected a structured transaction intent.");
    return failure();
  }
  if (!TRANSACTION_INTENT_TYPES.includes(intent.intentType)) {
    addIssue("UNSUPPORTED_INTENT", "The intent type has no supported journal mapping.");
    return failure();
  }
  if (typeof intent.description !== "string" || !intent.description.trim()) {
    addIssue("INVALID_INTENT", "The original transaction description is required.");
  }
  if (typeof intent.amount !== "number" || !Number.isFinite(intent.amount) ||
      intent.amount <= 0 || intent.amount > Number.MAX_SAFE_INTEGER) {
    addIssue("INVALID_AMOUNT", "A positive finite amount within the safe numeric range is required.");
  }
  if (intent.currency === undefined) {
    addIssue("MISSING_CURRENCY", "An explicitly resolved currency is required.", false);
  } else if (typeof intent.currency !== "string" || intent.currency !== intent.currency.trim()) {
    addIssue("INVALID_CURRENCY", "Currency must be a string without surrounding whitespace; it is never corrected or inferred.");
  }
  if (intent.categoryHint !== undefined && typeof intent.categoryHint !== "string") {
    addIssue("INVALID_INTENT", "Category evidence must be a supported string; arbitrary values are never coerced.");
    return failure();
  }

  const metadata = isRecord(options) ? options : undefined;
  if (typeof metadata?.id !== "string" || !metadata.id.trim()) {
    addIssue("MISSING_ENTRY_ID", "The caller must supply the suggested entry ID.", false);
  }
  if (!isCalendarDate(metadata?.date)) {
    addIssue("INVALID_ENTRY_DATE", "The caller must supply a valid calendar date in YYYY-MM-DD format.", metadata?.date !== undefined && metadata.date !== "");
  }
  const accounts = metadata?.accounts === undefined ? DEFAULT_CHART_OF_ACCOUNTS : metadata.accounts;
  if (!Array.isArray(accounts) || !accounts.every((account) => isRecord(account) && typeof account.id === "string")) {
    addIssue("INVALID_ACCOUNT_CHART", "Expected a chart containing structured accounts with explicit IDs.");
    return failure();
  }

  function requireAccount(id: string, expectedType: AccountType, hint?: TransactionAccountHint): void {
    if (hint !== undefined) {
      if (!isRecord(hint) || typeof hint.id !== "string") {
        addIssue("INVALID_INTENT", "Account evidence must contain a structured account ID and type.");
      } else {
        if (hint.id !== id) addIssue("ACCOUNT_HINT_CONFLICT", `The account hint must agree with the explicit mapping to ${id}.`);
        if (hint.type !== expectedType) addIssue("ACCOUNT_TYPE_MISMATCH", `The hint for ${id} must have type ${expectedType}.`);
      }
    }
    const matches = accounts.filter((account) => account.id === id);
    if (matches.length === 0) {
      addIssue("ACCOUNT_NOT_FOUND", `Required account ${id} is absent from the supplied chart; no account was substituted.`);
    } else if (matches.length > 1) {
      addIssue("AMBIGUOUS_ACCOUNT", `Required account ${id} occurs more than once in the supplied chart.`);
    } else if (matches[0].type !== expectedType) {
      addIssue("ACCOUNT_TYPE_MISMATCH", `Chart account ${id} must have type ${expectedType}.`);
    }
  }

  function paymentAccount(hint: TransactionAccountHint | undefined, direction: "source" | "destination"): string | undefined {
    if (hint === undefined) {
      addIssue(direction === "source" ? "MISSING_SOURCE_ACCOUNT" : "MISSING_DESTINATION_ACCOUNT", `An explicit ${direction} account is required.`, false);
      return undefined;
    }
    if (!isRecord(hint) || typeof hint.id !== "string") {
      addIssue("INVALID_INTENT", `The ${direction} account evidence is malformed.`);
      return undefined;
    }
    if (hint.id !== "bank" && hint.id !== "cash") {
      addIssue("UNSUPPORTED_ACCOUNT", `The explicit ${direction} account is unsupported; only bank or cash can settle these intents.`);
      return undefined;
    }
    requireAccount(hint.id, "asset", hint);
    return hint.id;
  }

  const outgoing = intent.intentType === "expense_payment" || intent.intentType === "asset_purchase";
  const incoming = intent.intentType === "revenue_receipt" || intent.intentType === "owner_investment";
  if ((!outgoing && intent.sourceAccountHint !== undefined) || (!incoming && intent.destinationAccountHint !== undefined)) {
    addIssue("CONFLICTING_ACCOUNT_EVIDENCE", "Settlement account evidence conflicts with the intent's payment direction or on-account status.");
  }

  let primaryId: string | undefined;
  let primaryType: AccountType;
  if (intent.intentType === "expense_payment" || intent.intentType === "expense_on_account") {
    primaryType = "expense";
    if (intent.categoryHint === undefined) {
      addIssue("MISSING_CATEGORY", "An explicit expense category is required even when an account hint is present.", false);
    } else if (Object.hasOwn(EXPENSE_ACCOUNTS, intent.categoryHint)) {
      primaryId = EXPENSE_ACCOUNTS[intent.categoryHint as keyof typeof EXPENSE_ACCOUNTS];
    } else addIssue("UNSUPPORTED_CATEGORY", "Only rent, salaries, and utilities expenses have supported mappings.");
  } else if (intent.intentType === "asset_purchase") {
    primaryType = "asset";
    if (intent.categoryHint === undefined) addIssue("MISSING_CATEGORY", "An explicit asset category is required.", false);
    else if (intent.categoryHint === "laptop" || intent.categoryHint === "computer") primaryId = "computer-equipment";
    else addIssue("UNSUPPORTED_CATEGORY", "Only laptop and computer purchases map to Computer Equipment.");
  } else if (intent.intentType === "owner_investment") {
    primaryType = "equity";
    primaryId = "owners-equity";
    if (intent.categoryHint !== undefined) addIssue("UNSUPPORTED_CATEGORY", "Owner investments do not use an expense, revenue, or equipment category.");
  } else {
    primaryType = "revenue";
    if (intent.categoryHint === undefined) addIssue("MISSING_CATEGORY", "Explicit services evidence is required to recognize revenue.", false);
    else if (intent.categoryHint === "services") primaryId = "revenue";
    else addIssue("UNSUPPORTED_CATEGORY", "Only explicit service revenue has a supported mapping.");
  }

  if (intent.accountHint === undefined) {
    addIssue("MISSING_ACCOUNT_HINT", "The resolved primary account hint is required; no account is inferred from missing evidence.", false);
  } else if (primaryId) requireAccount(primaryId, primaryType, intent.accountHint);

  let debitId = primaryId;
  let creditId: string | undefined;
  if (outgoing) creditId = paymentAccount(intent.sourceAccountHint, "source");
  else if (incoming) {
    debitId = paymentAccount(intent.destinationAccountHint, "destination");
    creditId = primaryId;
  } else if (intent.intentType === "expense_on_account") {
    creditId = "accounts-payable";
    requireAccount(creditId, "liability");
  } else {
    debitId = "accounts-receivable";
    creditId = primaryId;
    requireAccount(debitId, "asset");
  }

  if (issues.length) return failure();
  // Guards above establish the metadata and both accounts without inventing any evidence.
  const entry: JournalEntry = {
    id: metadata!.id,
    date: metadata!.date,
    description: intent.description,
    currency: intent.currency,
    lines: [
      { accountId: debitId!, debit: intent.amount, credit: 0 },
      { accountId: creditId!, debit: 0, credit: intent.amount },
    ],
  };
  const validation = validateJournalEntry(entry, accounts);
  if (!validation.valid) {
    rejected = true;
    issues.push({
      code: "ACCOUNTING_VALIDATION_FAILED",
      message: "The Accounting Core rejected the proposed entry; no suggestion was returned.",
      validationErrors: validation.errors,
    });
    return failure();
  }
  return { status: "suggested", suggestion: { entry, intent }, issues: [] };
}
