"use client";

import { useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/layout/Sidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import ChatInput from "@/components/chat/ChatInput";
import SuggestedQuestions from "@/components/chat/SuggestedQuestions";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import { routeFinancialQuestion } from "@/lib/analysis/chat";
import type { AnalystInterpretation } from "@/lib/ai/types";

type Message = { sender: "user"; text: string } | { sender: "ai"; text: string; interpretation?: AnalystInterpretation; facts?: Array<{ label: string; value: number; unit: import("@/lib/financial/types").FinancialFactUnit }> };

export default function ChatPage() {
  const { dataset, isReady } = useLedgerData();
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { sender: "ai", text: "I answer financial facts deterministically from your current dataset. Interpretive questions use local Ollama; no external AI provider is used." },
  ]);

  async function handleSend(message: string) {
    setMessages((current) => [...current, { sender: "user", text: message }]);
    try {
      const result = await routeFinancialQuestion(message, dataset, async (request) => {
        setBusy(true);
        let failureMessage = "The local Ollama analyst could not respond. Check that Ollama is running and qwen3:8b is available, then retry.";
        try {
          const response = await fetch("/api/analyst", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(request) });
          const payload: unknown = await response.json();
          if (!response.ok) {
            if (payload && typeof payload === "object" && "error" in payload) {
              const error = (payload as { error?: { message?: unknown } }).error;
              if (typeof error?.message === "string") failureMessage = error.message;
            }
            throw new Error(failureMessage);
          }
          if (!payload || typeof payload !== "object" || !("interpretation" in payload)) throw new Error("Invalid local analyst response");
          return (payload as { interpretation: AnalystInterpretation }).interpretation;
        } finally {
          setBusy(false);
        }
      });
      if (result.route === "local") setMessages((current) => [...current, { sender: "ai", text: result.text }]);
      else setMessages((current) => [...current, { sender: "ai", text: "Local Ollama qualitative interpretation only", interpretation: result.interpretation, facts: result.facts }]);
    } catch (error) {
      const text = error instanceof Error && error.message ? error.message : "The local Ollama analyst could not respond. Check that Ollama is running and qwen3:8b is available, then retry.";
      setMessages((current) => [...current, { sender: "ai", text }]);
    }
  }

  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />
      <main className="flex-1 p-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="mb-2 text-4xl font-bold">AI Analyst</h1>
              <p className="text-zinc-400">Verified facts are calculated locally. Interpretive responses use local Ollama; financial numbers remain deterministic.</p>
            </div>
            <Link href="/dashboard" className="rounded-xl border border-zinc-700 px-4 py-2 font-semibold text-white hover:bg-zinc-900">Back to dashboard</Link>
          </div>
          {!isReady && <p className="mt-8 text-zinc-400" role="status">Restoring the latest saved dataset...</p>}
          {isReady && !dataset && <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-8" aria-labelledby="empty-chat-title">
            <h2 id="empty-chat-title" className="text-2xl font-bold">Upload a dataset to start</h2>
            <p className="mt-2 text-zinc-400">The AI Analyst uses the same financial dataset as your dashboard. Upload a file first, then return here to ask questions.</p>
            <Link href="/" className="mt-5 inline-flex rounded-xl bg-green-500 px-5 py-3 font-semibold text-black hover:bg-green-600">Go to file upload</Link>
          </section>}
          {dataset && <>
            <p className="mb-6 text-sm text-zinc-400">Using {dataset.uploadedFile.name} - {dataset.summary.rowsAnalyzed} rows analyzed ({dataset.summary.quality} quality).</p>
            <SuggestedQuestions onSelect={handleSend} />
            <ChatWindow messages={messages} />
            {busy && <p className="my-2 text-sm text-zinc-400" role="status">Querying local Ollama...</p>}
            <ChatInput onSend={handleSend} />
          </>}
        </div>
      </main>
    </div>
  );
}
