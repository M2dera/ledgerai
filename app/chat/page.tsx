"use client";

import { useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import ChatInput from "@/components/chat/ChatInput";
import SuggestedQuestions from "@/components/chat/SuggestedQuestions";
import FileUpload from "@/components/upload/FileUpload";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import { answerFinancialQuestion, isInterpretiveQuestion } from "@/lib/analysis/chat";
import { createFinancialContext } from "@/lib/ai/context";
import type { AnalystInterpretation } from "@/lib/ai/types";

type Message = { sender: "user"; text: string } | { sender: "ai"; text: string; interpretation?: AnalystInterpretation; facts?: Array<{ label: string; value: number; unit: import("@/lib/financial/types").FinancialUnit }> };

export default function ChatPage() {
  const { dataset } = useLedgerData();
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { sender: "ai", text: "I answer financial facts deterministically from your current dataset. Interpretive questions use a local mock provider; no real AI service is connected." },
  ]);

  async function handleSend(message: string) {
    setMessages((current) => [...current, { sender: "user", text: message }]);
    if (!dataset || !isInterpretiveQuestion(message)) {
      setMessages((current) => [...current, { sender: "ai", text: answerFinancialQuestion(message, dataset) }]);
      return;
    }
    setBusy(true);
    try {
      const context = createFinancialContext(dataset);
      const response = await fetch("/api/analyst", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ question: message, context }) });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || !("interpretation" in payload)) throw new Error("Analyst unavailable");
      const interpretation = (payload as { interpretation: AnalystInterpretation }).interpretation;
      const facts = interpretation.evidenceFactIds.flatMap((id) => {
        const fact = context.facts.find((candidate) => candidate.id === id);
        return fact ? [{ label: fact.label, value: fact.value, unit: fact.unit }] : [];
      });
      setMessages((current) => [...current, { sender: "ai", text: "Mock provider · qualitative only", interpretation, facts }]);
    } catch {
      setMessages((current) => [...current, { sender: "ai", text: "The local analyst mock could not respond. Verified totals remain available through direct questions." }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />
      <main className="flex-1 p-10">
        <div className="mx-auto max-w-5xl">
          <h1 className="mb-2 text-4xl font-bold">Ledger<span className="text-green-400">AI</span> Data Assistant</h1>
          <p className="mb-8 text-zinc-400">Verified facts are calculated locally. Interpretive responses come from a deterministic mock; no real AI model is connected.</p>
          {!dataset && <div className="mb-6"><FileUpload /></div>}
          {dataset && <p className="mb-6 text-sm text-zinc-400">Using {dataset.uploadedFile.name} · {dataset.summary.rowsAnalyzed} rows analyzed ({dataset.summary.quality} quality).</p>}
          <SuggestedQuestions onSelect={handleSend} />
          <ChatWindow messages={messages} />
          {busy && <p className="my-2 text-sm text-zinc-400">Preparing local mock interpretation…</p>}
          <ChatInput onSend={handleSend} />
        </div>
      </main>
    </div>
  );
}
