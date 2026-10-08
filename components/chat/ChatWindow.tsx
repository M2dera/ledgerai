import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import type { ChatMessage } from "@/lib/chat";
import { formatFinancialFactValue } from "@/lib/financial/unit";

type ChatWindowProps = { messages: ChatMessage[]; onApprove?: (transactionId: string) => void; onPost?: (transactionId: string) => void };

export default function ChatWindow({ messages, onApprove, onPost }: ChatWindowProps) {
  return (
    <div className="flex h-[600px] flex-col rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-6 text-2xl font-bold">LedgerAI Assistant</h2>
      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.map((message, index) => (
          <div key={index} className={`max-w-[90%] rounded-xl px-4 py-3 ${message.sender === "user" ? "ml-auto bg-green-500 text-black" : "bg-zinc-800 text-white"}`}>
            <p className="whitespace-pre-line" dir="auto">{message.text}</p>
            {message.sender === "ai" && message.transaction && <div className="mt-3 space-y-3 border-t border-zinc-700 pt-3 text-sm">
              <section><h3 className="font-semibold text-zinc-300">Transaction</h3><p className="mt-1" dir="auto">{message.transaction.suggestion.intent.description}</p></section>
              <section><h3 className="font-semibold text-green-300">Suggested Journal Entry</h3>
                <ul className="mt-1 space-y-1" dir="ltr">{message.transaction.suggestion.entry.lines.map((line, i) => (
                  <li key={i}>{line.debit > 0 ? "Debit" : "Credit"} {DEFAULT_CHART_OF_ACCOUNTS.find((account) => account.id === line.accountId)?.name}: {line.debit > 0 ? line.debit : line.credit} {message.transaction!.suggestion.entry.currency}</li>
                ))}</ul>
              </section>
              <section><h3 className="font-semibold text-zinc-300">Status</h3><p className={`mt-1 ${message.transaction.status === "approved" || message.transaction.status === "posted" ? "text-green-300" : "text-yellow-300"}`} role="status">{message.transaction.status === "posted" ? "Posted" : message.transaction.status === "approved" ? "Approved" : message.transaction.status === "draft" ? "Draft" : "Awaiting approval"}</p></section>
              {message.transaction.status === "awaiting_approval" && onApprove && <button type="button" onClick={() => onApprove(message.transaction!.suggestion.entry.id)} className="rounded-lg bg-green-500 px-4 py-2 font-semibold text-black hover:bg-green-400">Approve</button>}
              {message.transaction.status === "approved" && onPost && <button type="button" onClick={() => onPost(message.transaction!.suggestion.entry.id)} className="rounded-lg bg-green-500 px-4 py-2 font-semibold text-black hover:bg-green-400">Post</button>}
              {message.transaction.status === "posted" && <p className="text-green-300">Transaction posted to the session ledger.</p>}
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
        ))}
      </div>
    </div>
  );
}
