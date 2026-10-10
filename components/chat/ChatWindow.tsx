import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import { getTransactionAuditEvents } from "@/lib/accounting/audit-trail";
import type { JournalTransaction } from "@/lib/accounting/transaction-workflow";
import type { JournalEntry } from "@/lib/accounting/types";
import type { ChatMessage } from "@/lib/chat";
import { formatFinancialFactValue } from "@/lib/financial/unit";
import EntryExplanation from "./EntryExplanation";
import JournalEntryEditor from "./JournalEntryEditor";
import TransactionAuditTrail from "./TransactionAuditTrail";

type ChatWindowProps = {
  messages: ChatMessage[];
  onApprove?: (transactionId: string) => void;
  onPost?: (transactionId: string) => void;
  onReverse?: (transactionId: string) => void;
  onEdit?: (transactionId: string, entry: JournalEntry) => void;
  editingError?: { transactionId: string; message: string };
};

const statusLabels = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  posted: "Posted",
  reversed: "Reversed",
};

const reversalMessages: Record<JournalTransaction["status"], string> = {
  draft: "Reversing journal entry.",
  awaiting_approval: "Review this reversal, then approve and post it.",
  approved: "Reversal approved. Post it to the session ledger.",
  posted: "Reversal posted to the session ledger.",
  reversed: "Reversal transaction reversed.",
};

export default function ChatWindow({ messages, onApprove, onPost, onReverse, onEdit, editingError }: ChatWindowProps) {
  const transactions = messages.flatMap((message) => message.sender === "ai" && message.transaction ? [message.transaction] : []);
  const reversalsByOriginalId = new Map<string, JournalTransaction>();
  for (const message of messages) {
    if (message.sender === "ai" && message.transaction?.reversalOfTransactionId) {
      reversalsByOriginalId.set(message.transaction.reversalOfTransactionId, message.transaction);
    }
  }

  return (
    <div className="flex h-[600px] flex-col rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-6 text-2xl font-bold">LedgerAI Assistant</h2>
      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.map((message, index) => {
          const linkedReversal = message.sender === "ai" && message.transaction
            ? reversalsByOriginalId.get(message.transaction.suggestion.entry.id)
            : undefined;
          const messageText = message.sender === "ai" && message.transaction?.reversalOfTransactionId
            ? reversalMessages[message.transaction.status]
            : message.text;
          return (
          <div
            key={index}
            id={message.sender === "ai" && message.transaction ? `transaction-${message.transaction.suggestion.entry.id}` : undefined}
            className={`max-w-[90%] rounded-xl px-4 py-3 ${message.sender === "user" ? "ml-auto bg-green-500 text-black" : "bg-zinc-800 text-white"}`}
          >
            <p className="whitespace-pre-line" dir="auto">{messageText}</p>
            {message.sender === "ai" && message.transaction && <div className="mt-3 space-y-3 border-t border-zinc-700 pt-3 text-sm">
              <section><h3 className="font-semibold text-zinc-300">Transaction</h3><p className="mt-1" dir="auto">{message.transaction.suggestion.intent.description}</p>
                <p className="mt-1 text-zinc-400">Transaction ID: {message.transaction.suggestion.entry.id}</p>
                {message.transaction.reversalOfTransactionId && <p className="mt-1 text-zinc-300">Reversal of transaction: {message.transaction.reversalOfTransactionId}</p>}
              </section>
              <section><h3 className="font-semibold text-green-300">{message.transaction.reversalOfTransactionId ? "Reversing Journal Entry" : "Suggested Journal Entry"}</h3>
                <p className="mt-1" dir="auto">{message.transaction.suggestion.entry.description}</p>
                <p className="mt-1 text-zinc-400">Date: {message.transaction.suggestion.entry.date} · Currency: {message.transaction.suggestion.entry.currency}</p>
                <ul className="mt-1 space-y-1" dir="ltr">{message.transaction.suggestion.entry.lines.map((line, i) => (
                  <li key={i}>{line.debit > 0 ? "Debit" : "Credit"} {DEFAULT_CHART_OF_ACCOUNTS.find((account) => account.id === line.accountId)?.name}: {line.debit > 0 ? line.debit : line.credit} {message.transaction!.suggestion.entry.currency}</li>
                ))}</ul>
              </section>
              {message.transaction.status === "awaiting_approval" && !message.transaction.reversalOfTransactionId && (
                <EntryExplanation key={`${message.transaction.suggestion.entry.id}:${JSON.stringify(message.transaction.suggestion.entry.lines)}`} entry={message.transaction.suggestion.entry} />
              )}
              <section><h3 className="font-semibold text-zinc-300">Status</h3><p className={`mt-1 ${message.transaction.status === "approved" || message.transaction.status === "posted" || message.transaction.status === "reversed" ? "text-green-300" : "text-yellow-300"}`} role="status">{statusLabels[message.transaction.status]}</p>
                {message.transaction.status === "posted" && linkedReversal && <p className="mt-1 text-zinc-300">Reversal: {linkedReversal.suggestion.entry.id} · {statusLabels[linkedReversal.status]}</p>}
                {message.transaction.status === "reversed" && <p className="mt-1 text-zinc-300">Reversed by transaction: {message.transaction.reversedByTransactionId}</p>}
              </section>
              {onEdit && (message.transaction.status === "awaiting_approval" || message.transaction.status === "approved") ? (
                <JournalEntryEditor
                  entry={message.transaction.suggestion.entry}
                  onSave={(entry) => onEdit(message.transaction!.suggestion.entry.id, entry)}
                  error={editingError?.transactionId === message.transaction.suggestion.entry.id ? editingError.message : undefined}
                >
                  {message.transaction.status === "awaiting_approval" && onApprove && <button type="button" onClick={() => onApprove(message.transaction!.suggestion.entry.id)} className="rounded-lg bg-green-500 px-4 py-2 font-semibold text-black hover:bg-green-400">Approve</button>}
                  {message.transaction.status === "approved" && onPost && <button type="button" onClick={() => onPost(message.transaction!.suggestion.entry.id)} className="rounded-lg bg-green-500 px-4 py-2 font-semibold text-black hover:bg-green-400">Post</button>}
                </JournalEntryEditor>
              ) : <>
                {message.transaction.status === "awaiting_approval" && onApprove && <button type="button" onClick={() => onApprove(message.transaction!.suggestion.entry.id)} className="rounded-lg bg-green-500 px-4 py-2 font-semibold text-black hover:bg-green-400">Approve</button>}
                {message.transaction.status === "approved" && onPost && <button type="button" onClick={() => onPost(message.transaction!.suggestion.entry.id)} className="rounded-lg bg-green-500 px-4 py-2 font-semibold text-black hover:bg-green-400">Post</button>}
              </>}
              {message.transaction.status === "posted" && <p className="text-green-300">Transaction posted to the session ledger.</p>}
              {message.transaction.status === "posted" && !message.transaction.reversalOfTransactionId && !message.transaction.reversedByTransactionId && !linkedReversal && onReverse && <button type="button" onClick={() => onReverse(message.transaction!.suggestion.entry.id)} className="rounded-lg border border-zinc-600 px-4 py-2 font-semibold text-zinc-200 hover:bg-zinc-700">Reverse</button>}
              {message.transaction.status === "reversed" && <p className="text-green-300">Original entry and posted reversal remain in the session ledger.</p>}
              <TransactionAuditTrail events={getTransactionAuditEvents(message.transaction.suggestion.entry.id, transactions)} />
            </div>}
            {message.sender === "ai" && message.interpretation && <div className="mt-3 space-y-3 border-t border-zinc-700 pt-3 text-sm">
              <section><h3 className="font-semibold text-green-300">Verified Facts</h3>
                {message.facts?.length ? <ul className="mt-1 list-inside list-disc text-zinc-200">{message.facts.map((fact, i) => <li key={`${fact.label}-${i}`}>{fact.label}: {formatFinancialFactValue(fact.value, fact.unit)}</li>)}</ul> : <p className="text-zinc-400">No verified facts were referenced.</p>}
              </section>
              <section><h3 className="font-semibold text-blue-300">{message.interpretation.provider === "ollama" ? "Local AI Interpretation · Ollama" : "AI Interpretation (mock)"}</h3><p className="mt-1 text-zinc-200">{message.interpretation.interpretation}</p></section>
              <section><h3 className="font-semibold text-yellow-300">Investigate Next</h3><ul className="mt-1 list-inside list-disc text-zinc-300">{message.interpretation.investigateNext.map((item, i) => <li key={i}>{item}</li>)}</ul></section>
              <section><h3 className="font-semibold text-zinc-400">Data Quality / Uncertainty</h3><ul className="mt-1 list-inside list-disc text-zinc-400">{message.interpretation.uncertainty.map((item, i) => <li key={i}>{item}</li>)}</ul></section>
            </div>}
          </div>
          );
        })}
      </div>
    </div>
  );
}
