import { isTransactionStatement, parseTransactionIntent, type TransactionIntentIssue } from "@/lib/accounting/transaction-intent";
import { suggestJournalEntry, type SuggestedJournalEntry, type SuggestedJournalEntryIssue, type SuggestedJournalEntryOptions } from "@/lib/accounting/suggested-journal-entry";
import { transitionJournalTransaction, type JournalTransaction } from "@/lib/accounting/transaction-workflow";
import { routeFinancialQuestion, type AnalystRequestHandler, type ChatRoutingResult } from "@/lib/analysis/chat";
import type { AnalystInterpretation } from "@/lib/ai/types";
import type { FinancialDataset, FinancialFactUnit } from "@/lib/financial/types";

export type ChatMessage =
  | { sender: "user"; text: string }
  | { sender: "ai"; text: string; transaction?: JournalTransaction; interpretation?: AnalystInterpretation; facts?: Array<{ label: string; value: number; unit: FinancialFactUnit }> };

export type TransactionChatResult =
  | { route: "transaction"; status: "suggested"; text: string; suggestion: SuggestedJournalEntry }
  | { route: "transaction"; status: "unresolved" | "unsupported" | "rejected"; text: string; issues: readonly (TransactionIntentIssue | SuggestedJournalEntryIssue)[] };

/** Called only by the explicit approval action; stale clicks leave messages unchanged. */
export function approveChatTransaction(messages: ChatMessage[], transactionId: string): ChatMessage[] {
  return messages.map((message) => {
    if (message.sender !== "ai" || !message.transaction ||
        message.transaction.suggestion.entry.id !== transactionId ||
        message.transaction.status !== "awaiting_approval") return message;
    return { ...message, transaction: transitionJournalTransaction(message.transaction, "approved") };
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
  options: Pick<SuggestedJournalEntryOptions, "id" | "date">,
): Promise<ChatRoutingResult | TransactionChatResult> {
  const parsed = parseTransactionIntent(message);
  if (parsed.status === "unsupported" && !isTransactionStatement(message) && !isUnsupportedTransactionAttempt(message)) {
    return routeFinancialQuestion(message, dataset, requestAnalyst);
  }

  const isArabic = /[\u0600-\u06ff]/u.test(message);
  if (parsed.status !== "resolved") {
    return {
      route: "transaction",
      status: parsed.status,
      text: parsed.issues.map((issue) => isArabic ? arabicClarifications[issue.code] : issue.message).join("\n"),
      issues: parsed.issues,
    };
  }

  // suggestJournalEntry runs Accounting Core validation before returning a suggestion.
  const result = suggestJournalEntry(parsed.intent, options);
  if (result.status === "suggested") {
    return { route: "transaction", status: "suggested", text: "Accounting suggestion", suggestion: result.suggestion };
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
