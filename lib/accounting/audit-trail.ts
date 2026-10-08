import type { JournalTransaction } from "./transaction-workflow";
import type { JournalEntry, JournalEntryLine } from "./types";

export type AuditContext = { readonly timestamp: string };

export type JournalEntryAuditSnapshot = Readonly<Omit<JournalEntry, "lines">> & {
  readonly lines: readonly Readonly<JournalEntryLine>[];
};

type AuditEventBase = {
  readonly id: string;
  readonly transactionId: string;
  readonly timestamp: string;
  readonly relatedTransactionId?: string;
};
type EntryMetadata = { readonly entry: JournalEntryAuditSnapshot };
type EntryEvent<Type extends string, Previous, Next> = AuditEventBase & {
  readonly type: Type;
  readonly previousStatus: Previous;
  readonly newStatus: Next;
  readonly metadata: EntryMetadata;
};

export type TransactionAuditEvent =
  | EntryEvent<"transaction_created", null, "draft" | "awaiting_approval">
  | EntryEvent<"transaction_submitted_for_approval", "draft", "awaiting_approval">
  | (AuditEventBase & {
      readonly type: "transaction_edited";
      readonly previousStatus: "awaiting_approval" | "approved";
      readonly newStatus: "awaiting_approval";
      readonly metadata: { readonly before: JournalEntryAuditSnapshot; readonly after: JournalEntryAuditSnapshot };
    })
  | EntryEvent<"transaction_approved", "awaiting_approval", "approved">
  | EntryEvent<"transaction_posted", "approved", "posted">
  | (EntryEvent<"transaction_reversal_created", "posted", "posted"> & { readonly relatedTransactionId: string })
  | (EntryEvent<"transaction_reversal_posted", "posted", "posted"> & { readonly relatedTransactionId: string })
  | (EntryEvent<"transaction_marked_reversed", "posted", "reversed"> & { readonly relatedTransactionId: string });

export type TransactionAuditEventType = TransactionAuditEvent["type"];
type EventDetails = {
  [Type in TransactionAuditEventType]: Omit<Extract<TransactionAuditEvent, { type: Type }>, "id" | "transactionId" | "timestamp">;
}[TransactionAuditEventType];

/** Capture once at an action boundary, outside a React state updater; tests can supply a fixed context. */
export function captureAuditContext(): AuditContext {
  return Object.freeze({ timestamp: new Date().toISOString() });
}

function snapshot(entry: JournalEntry): JournalEntryAuditSnapshot {
  return Object.freeze({
    id: entry.id,
    date: entry.date,
    description: entry.description,
    currency: entry.currency,
    lines: Object.freeze(entry.lines.map(({ accountId, debit, credit }) => Object.freeze({ accountId, debit, credit }))),
  });
}

function appendEvents(
  transaction: JournalTransaction,
  history: readonly TransactionAuditEvent[],
  details: readonly EventDetails[],
  context: AuditContext,
): JournalTransaction {
  const transactionId = transaction.suggestion.entry.id;
  const timestamp = new Date(context.timestamp).toISOString();
  const events = details.map((detail, index) => Object.freeze({
    ...detail,
    id: `${transactionId}:audit:${history.length + index + 1}`,
    transactionId,
    timestamp,
  }));
  return { ...transaction, auditEvents: Object.freeze([...history, ...events]) };
}

/** Accounting-internal: records a successful reversal creation on the affected original. */
export function appendReversalCreationAudit(
  original: JournalTransaction,
  reversal: JournalTransaction,
  context: AuditContext,
): JournalTransaction {
  if (original.status !== "posted" || original.reversalOfTransactionId !== undefined ||
      reversal.status !== "awaiting_approval" || reversal.reversalOfTransactionId !== original.suggestion.entry.id) {
    throw new Error("Reversal creation audit requires the original posted transaction and its new reversal.");
  }
  return appendEvents(original, original.auditEvents ?? [], [{
    type: "transaction_reversal_created", previousStatus: "posted", newStatus: "posted",
    relatedTransactionId: reversal.suggestion.entry.id,
    metadata: Object.freeze({ entry: snapshot(original.suggestion.entry) }),
  }], context);
}

/** Accounting-internal: derives events from successful lifecycle results, never accepts arbitrary event payloads. */
export function appendTransactionAudit(
  before: JournalTransaction | undefined,
  next: JournalTransaction,
  context: AuditContext = captureAuditContext(),
): JournalTransaction {
  const transactionId = next.suggestion.entry.id;
  if (before && before.suggestion.entry.id !== transactionId) throw new Error("Audit changes must preserve the transaction ID.");
  const relatedTransactionId = next.reversalOfTransactionId ?? next.reversedByTransactionId;
  const related = relatedTransactionId === undefined ? {} : { relatedTransactionId };
  const entryMetadata = () => Object.freeze({ entry: snapshot(next.suggestion.entry) });
  const details: EventDetails[] = [];

  if (!before && (next.status === "draft" || next.status === "awaiting_approval")) {
    const metadata = entryMetadata();
    details.push({ type: "transaction_created", previousStatus: null, newStatus: next.status, ...related, metadata });
  } else if (before && before.suggestion.entry !== next.suggestion.entry &&
      (before.status === "awaiting_approval" || before.status === "approved") && next.status === "awaiting_approval") {
    details.push({
      type: "transaction_edited", previousStatus: before.status, newStatus: "awaiting_approval", ...related,
      metadata: Object.freeze({ before: snapshot(before.suggestion.entry), after: snapshot(next.suggestion.entry) }),
    });
  } else if (before?.status === "draft" && next.status === "awaiting_approval") {
    details.push({ type: "transaction_submitted_for_approval", previousStatus: "draft", newStatus: "awaiting_approval", ...related, metadata: entryMetadata() });
  } else if (before?.status === "awaiting_approval" && next.status === "approved") {
    details.push({ type: "transaction_approved", previousStatus: "awaiting_approval", newStatus: "approved", ...related, metadata: entryMetadata() });
  } else if (before?.status === "approved" && next.status === "posted") {
    const metadata = entryMetadata();
    details.push({ type: "transaction_posted", previousStatus: "approved", newStatus: "posted", ...related, metadata });
  } else if (before?.status === "posted" && next.status === "reversed" && next.reversedByTransactionId !== undefined) {
    const metadata = entryMetadata();
    details.push({ type: "transaction_reversal_posted", previousStatus: "posted", newStatus: "posted", relatedTransactionId: next.reversedByTransactionId, metadata });
    details.push({ type: "transaction_marked_reversed", previousStatus: "posted", newStatus: "reversed", relatedTransactionId: next.reversedByTransactionId, metadata });
  } else {
    throw new Error("Audit events require a supported successful transaction action.");
  }

  return appendEvents(next, before?.auditEvents ?? [], details, context);
}

/** Read-only transaction view; related IDs provide context without importing another transaction's events. */
export function getTransactionAuditEvents(
  transactionId: string,
  transactions: readonly JournalTransaction[],
): readonly TransactionAuditEvent[] {
  const events = new Map<string, TransactionAuditEvent>();
  for (const transaction of transactions) {
    for (const event of transaction.auditEvents ?? []) {
      if (event.transactionId === transactionId) {
        events.set(event.id, event);
      }
    }
  }
  return Object.freeze([...events.values()].sort((left, right) => {
    const timeOrder = left.timestamp.localeCompare(right.timestamp);
    if (timeOrder) return timeOrder;
    return Number(left.id.slice(left.id.lastIndexOf(":") + 1)) - Number(right.id.slice(right.id.lastIndexOf(":") + 1));
  }));
}
