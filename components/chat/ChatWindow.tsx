import type { AnalystInterpretation } from "@/lib/ai/types";
import type { FinancialFactUnit } from "@/lib/financial/types";
import { formatFinancialFactValue } from "@/lib/financial/unit";

type Message = { sender: "user"; text: string } | { sender: "ai"; text: string; interpretation?: AnalystInterpretation; facts?: Array<{ label: string; value: number; unit: FinancialFactUnit }> };

type ChatWindowProps = { messages: Message[] };

export default function ChatWindow({ messages }: ChatWindowProps) {
  return (
    <div className="flex h-[600px] flex-col rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-6 text-2xl font-bold">LedgerAI Assistant</h2>
      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.map((message, index) => (
          <div key={index} className={`max-w-[90%] rounded-xl px-4 py-3 ${message.sender === "user" ? "ml-auto bg-green-500 text-black" : "bg-zinc-800 text-white"}`}>
            <p>{message.text}</p>
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
