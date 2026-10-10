import { isTransactionStatement, parseTransactionIntent, type TransactionIntentIssue } from "@/lib/accounting/transaction-intent";
import { suggestJournalEntry, type SuggestedJournalEntry, type SuggestedJournalEntryIssue, type SuggestedJournalEntryOptions } from "@/lib/accounting/suggested-journal-entry";
import { transitionJournalTransaction, type JournalTransaction } from "@/lib/accounting/transaction-workflow";
import { createAccountingLedgerState, postJournalTransaction, type AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { editJournalTransaction } from "@/lib/accounting/transaction-editing";
import { createJournalReversal, markJournalTransactionReversed } from "@/lib/accounting/transaction-reversal";
import { captureAuditContext, type AuditContext } from "@/lib/accounting/audit-trail";
import type { JournalEntry } from "@/lib/accounting/types";
import { routeFinancialQuestion, type AnalystRequestHandler, type ChatRoutingResult } from "@/lib/analysis/chat";
import type { AnalystInterpretation } from "@/lib/ai/types";
import { getMissingSettlementClarification, validateTransactionInterpretation } from "@/lib/accounting/transaction-understanding";
import { answerAccountingQuestion } from "@/lib/analysis/accounting-question";
import type { FinancialDataset, FinancialFactUnit } from "@/lib/financial/types";

export type ChatMessage =
  | { sender: "user"; text: string }
  | { sender: "ai"; text: string; transaction?: JournalTransaction; interpretation?: AnalystInterpretation; facts?: Array<{ label: string; value: number; unit: FinancialFactUnit }> };

export type TransactionChatResult =
  | { route: "transaction"; status: "suggested"; text: string; suggestion: SuggestedJournalEntry; assisted?: boolean }
  | { route: "transaction"; status: "unresolved" | "unsupported" | "rejected"; text: string; issues: readonly (TransactionIntentIssue | SuggestedJournalEntryIssue)[]; assisted?: boolean };

export type TransactionInterpreterHandler = (description: string) => Promise<unknown>;

export type ChatState = {
  messages: ChatMessage[];
  ledger: AccountingLedgerState;
  postingError?: string;
  editingError?: { transactionId: string; message: string };
  reversalError?: string;
};

export function createChatState(messages: ChatMessage[]): ChatState {
  return { messages, ledger: createAccountingLedgerState() };
}

/** Creates a separate reviewable reversal and reserves it in the current session state. */
export function reverseChatTransaction(state: ChatState, originalTransactionId: string, reversalTransactionId: string, auditContext: AuditContext = captureAuditContext()): ChatState {
  try {
    const transactions = state.messages.flatMap((message) => message.sender === "ai" && message.transaction ? [message.transaction] : []);
    const reversal = createJournalReversal(originalTransactionId, transactions, state.ledger, reversalTransactionId, undefined, auditContext);
    return {
      ...state,
      messages: [
        ...state.messages.map((message) => message.sender === "ai" && message.transaction?.suggestion.entry.id === originalTransactionId
          ? { ...message, transaction: reversal.originalTransaction } : message),
        { sender: "ai", text: "Review this reversal, then approve and post it.", transaction: reversal.transaction },
      ],
      ledger: reversal.ledger,
      reversalError: undefined,
      postingError: undefined,
    };
  } catch (error) {
    return { ...state, reversalError: error instanceof Error ? error.message : "The reversal could not be created." };
  }
}

/** Applies only a fully validated edit to one message and retains the exact ledger snapshot. */
export function editChatTransaction(state: ChatState, transactionId: string, entry: JournalEntry, auditContext: AuditContext = captureAuditContext()): ChatState {
  try {
    const matches = state.messages.filter((message) => message.sender === "ai" && message.transaction?.suggestion.entry.id === transactionId);
    if (matches.length !== 1) throw new Error("A single matching transaction is required for editing.");
    const message = matches[0];
    if (message.sender !== "ai" || !message.transaction) throw new Error("Transaction not found.");
    const edited = editJournalTransaction(message.transaction, entry, state.ledger, undefined, auditContext);
    return {
      ...state,
      messages: state.messages.map((current) => current === message ? { ...message, transaction: edited } : current),
      editingError: undefined,
      postingError: undefined,
    };
  } catch (error) {
    return {
      ...state,
      editingError: { transactionId, message: error instanceof Error ? error.message : "The journal entry could not be edited." },
    };
  }
}

/** One atomic update keeps the posted status and ledger consistent, including stale clicks. */
export function postChatTransaction(state: ChatState, transactionId: string, auditContext: AuditContext = captureAuditContext()): ChatState {
  try {
    const matches = state.messages.filter((message) => message.sender === "ai" && message.transaction?.suggestion.entry.id === transactionId);
    if (matches.length !== 1) throw new Error("A single matching transaction is required for posting.");
    const message = matches[0];
    if (message.sender !== "ai" || !message.transaction) throw new Error("Transaction not found.");
    const originalId = message.transaction.reversalOfTransactionId;
    const originalMatches = originalId === undefined ? [] : state.messages.filter((current) =>
      current.sender === "ai" && current.transaction?.suggestion.entry.id === originalId);
    if (originalId !== undefined && originalMatches.length !== 1) {
      throw new Error("A single matching original transaction is required for reversal posting.");
    }
    const originalMessage = originalMatches[0];
    const posted = postJournalTransaction(message.transaction, state.ledger, undefined, auditContext);
    const reversedOriginal = originalMessage?.sender === "ai" && originalMessage.transaction
      ? markJournalTransactionReversed(originalMessage.transaction, posted.ledger, undefined, auditContext)
      : undefined;
    return {
      messages: state.messages.map((current) => {
        if (current === message) return { ...message, transaction: posted.transaction };
        if (current === originalMessage && current.sender === "ai" && reversedOriginal) return { ...current, transaction: reversedOriginal };
        return current;
      }),
      ledger: posted.ledger,
      postingError: undefined,
    };
  } catch (error) {
    return { ...state, postingError: error instanceof Error ? error.message : "The transaction could not be posted." };
  }
}

/** Called only by the explicit approval action; stale clicks leave messages unchanged. */
export function approveChatTransaction(messages: ChatMessage[], transactionId: string, auditContext: AuditContext = captureAuditContext()): ChatMessage[] {
  return messages.map((message) => {
    if (message.sender !== "ai" || !message.transaction ||
        message.transaction.suggestion.entry.id !== transactionId ||
        message.transaction.status !== "awaiting_approval") return message;
    return { ...message, transaction: transitionJournalTransaction(message.transaction, "approved", undefined, auditContext) };
  });
}

const arabicClarifications: Record<TransactionIntentIssue["code"], string> = {
  INVALID_INPUT: "اكتب معاملة واحدة واضحة لا تتجاوز 1000 حرف.",
  UNSUPPORTED_TEXT: "لم أتمكن من اقتراح قيد آمن لهذه المعاملة. أعد صياغتها مع المبلغ والعملة والحسابات المذكورة صراحةً.",
  MISSING_AMOUNT: "ما مبلغ المعاملة؟",
  INVALID_AMOUNT: "يرجى تحديد مبلغ موجب وصحيح، بحد أقصى ثلاث منازل عشرية.",
  AMBIGUOUS_AMOUNT: "يوجد أكثر من مبلغ. يرجى كتابة معاملة واحدة بمبلغ واحد.",
  MISSING_CURRENCY: "ما عملة المعاملة؟",
  AMBIGUOUS_CURRENCY: "يرجى تحديد عملة واحدة واضحة للمعاملة.",
  MISSING_CATEGORY: "ما نوع المصروف أو الأصل المذكور في المعاملة؟",
  AMBIGUOUS_CATEGORY: "يوجد أكثر من تصنيف. يرجى تحديد تصنيف واحد للمعاملة.",
  MISSING_SOURCE_ACCOUNT: "من أي حساب تم الدفع: البنك أم الصندوق؟",
  MISSING_DESTINATION_ACCOUNT: "في أي حساب تم استلام المبلغ: البنك أم الصندوق؟",
  AMBIGUOUS_ACCOUNT: "ذُكر أكثر من حساب. يرجى تحديد الحساب المستخدم: البنك أم الصندوق؟",
  ASSET_ACCOUNT_REQUIRED: "يرجى تحديد نوع الأصل صراحةً حتى يمكن تحديد حسابه.",
  REVENUE_CONTEXT_REQUIRED: "هل المبلغ مقابل تقديم خدمة؟ لا يمكن تحديد حساب الإيراد دون توضيح طبيعة المعاملة.",
};

function isUnsupportedTransactionAttempt(message: string): boolean {
  // These prefixes remain unsupported evidence, rather than questions about historical totals.
  const statement = message.trim().normalize("NFKC");
  const withoutPrefix = statement.replace(/^(?:if (?:i|we)|(?:i|we)|ما)\s+/iu, "");
  return isTransactionStatement(withoutPrefix) || /^(?:(?:(?:i|we)\s+)?(?:will|did not|didn't)\s+(?:pay|receive|sell|buy|purchase|invest|inject)|transfer)(?:\s|$)/iu.test(statement);
}

/** Suggestions are transient: this router never posts entries or changes the dataset. */
export async function routeChatMessage(
  message: string,
  dataset: FinancialDataset | null,
  requestAnalyst: AnalystRequestHandler,
  options: Omit<Pick<SuggestedJournalEntryOptions, "date">, "id"> & {
    id: string | (() => string);
    requestTransactionInterpreter?: TransactionInterpreterHandler;
    accountingLedger?: Pick<AccountingLedgerState, "journalEntries">;
  },
): Promise<ChatRoutingResult | TransactionChatResult> {
  const accountingAnswer = answerAccountingQuestion(message, options.accountingLedger);
  if (accountingAnswer) return { route: "local", intent: "accounting_ledger", text: accountingAnswer.text };

  let parsed = parseTransactionIntent(message);
  if (parsed.status === "unsupported" && !isTransactionStatement(message) && !isUnsupportedTransactionAttempt(message)) {
    return routeFinancialQuestion(message, dataset, requestAnalyst);
  }

  const isArabic = /[\u0600-\u06ff]/u.test(message);
  let assisted = false;
  const monetaryEvidenceReady = parsed.intent.amount !== undefined && parsed.intent.currency !== undefined &&
    !parsed.issues.some(({ code }) => ["MISSING_AMOUNT", "INVALID_AMOUNT", "AMBIGUOUS_AMOUNT", "MISSING_CURRENCY", "AMBIGUOUS_CURRENCY"].includes(code));
  if (parsed.status !== "resolved" && monetaryEvidenceReady && isTransactionStatement(message) && options.requestTransactionInterpreter) {
    try {
      const candidate = await options.requestTransactionInterpreter(message);
      const interpreted = validateTransactionInterpretation(candidate, message);
      if (interpreted) {
        parsed = { status: "resolved", intent: interpreted, issues: [] };
        assisted = true;
      } else {
        const clarification = getMissingSettlementClarification(candidate, message);
        if (clarification) {
          parsed = { status: "unresolved", intent: parsed.intent, issues: [clarification] };
        }
      }
    } catch {
      // Provider failures preserve deterministic clarification; they never create a proposal.
    }
  }
  if (parsed.status !== "resolved") {
    return {
      route: "transaction",
      status: parsed.status,
      text: parsed.issues.map((issue) => isArabic ? arabicClarifications[issue.code] : issue.message).join("\n"),
      issues: parsed.issues,
    };
  }

  // suggestJournalEntry runs Accounting Core validation before returning a suggestion.
  const result = suggestJournalEntry(parsed.intent, {
    ...options,
    id: typeof options.id === "function" ? options.id() : options.id,
  });
  if (result.status === "suggested") {
    return { route: "transaction", status: "suggested", text: assisted ? "AI-assisted draft for review" : "Accounting suggestion", suggestion: result.suggestion, ...(assisted ? { assisted: true } : {}) };
  }
  return {
    route: "transaction",
    status: result.status,
    text: isArabic
      ? "تعذّر إنشاء اقتراح قيد صالح. يرجى مراجعة تفاصيل المعاملة قبل المحاولة مجدداً."
      : "A valid journal entry could not be suggested. Please review the transaction details and try again.",
    issues: result.issues,
  };
}
