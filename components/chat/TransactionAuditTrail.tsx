import type { JournalEntryAuditSnapshot, TransactionAuditEvent } from "@/lib/accounting/audit-trail";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";

const actionLabels: Record<TransactionAuditEvent["type"], string> = {
  transaction_created: "Transaction created",
  transaction_submitted_for_approval: "Submitted for approval",
  transaction_edited: "Transaction edited",
  transaction_approved: "Transaction approved",
  transaction_posted: "Transaction posted",
  transaction_reversal_created: "Reversal created",
  transaction_reversal_posted: "Reversal posted",
  transaction_marked_reversed: "Transaction marked reversed",
};

function EntryState({ label, entry }: { label: string; entry: JournalEntryAuditSnapshot }) {
  return (
    <section aria-label={`${label} journal entry`} className="min-w-0 rounded-lg border border-zinc-700 p-3">
      <p className="font-medium text-zinc-300">{label}</p>
      <p dir="auto">{entry.description}</p>
      <p>Date: {entry.date} · Currency: {entry.currency}</p>
      <ul className="space-y-1" dir="ltr">
        {entry.lines.map((line, index) => (
          <li key={index}>
            {line.debit > 0 ? "Debit" : "Credit"} {DEFAULT_CHART_OF_ACCOUNTS.find((account) => account.id === line.accountId)?.name ?? line.accountId}: {line.debit > 0 ? line.debit : line.credit} {entry.currency}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function TransactionAuditTrail({ events }: { events: readonly TransactionAuditEvent[] }) {
  if (!events.length) return null;

  return (
    <details className="border-t border-zinc-700 pt-3 text-zinc-400">
      <summary className="cursor-pointer font-semibold text-zinc-300">Audit trail</summary>
      <ol className="mt-3 space-y-3">
        {events.map((event) => (
          <li key={event.id} className="space-y-1">
            <p className="font-medium text-zinc-200">{actionLabels[event.type]}</p>
            <time dateTime={event.timestamp}>{event.timestamp}</time>
            <p>Transaction: {event.transactionId}</p>
            {event.previousStatus !== null && event.previousStatus !== event.newStatus && (
              <p>Status: {event.previousStatus.replaceAll("_", " ")} → {event.newStatus.replaceAll("_", " ")}</p>
            )}
            {event.previousStatus === null && <p>Status: {event.newStatus.replaceAll("_", " ")}</p>}
            {event.relatedTransactionId && <p>Related transaction: {event.relatedTransactionId}</p>}
            {event.type === "transaction_edited" && (
              <div className="pl-3">
                <p className="font-medium text-zinc-300">Journal entry changes</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <EntryState label="Before" entry={event.metadata.before} />
                  <EntryState label="After" entry={event.metadata.after} />
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
