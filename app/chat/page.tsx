"use client";

import { useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import ChatInput from "@/components/chat/ChatInput";
import SuggestedQuestions from "@/components/chat/SuggestedQuestions";
import FileUpload from "@/components/upload/FileUpload";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import { answerFinancialQuestion } from "@/lib/analysis/chat";

type Message = { sender: "user" | "ai"; text: string };

export default function ChatPage() {
  const { dataset } = useLedgerData();
  const [messages, setMessages] = useState<Message[]>([
    { sender: "ai", text: "I can answer questions using figures calculated from your current uploaded dataset. No AI service is connected." },
  ]);

  function handleSend(message: string) {
    const response = answerFinancialQuestion(message, dataset);
    setMessages((current) => [...current, { sender: "user", text: message }, { sender: "ai", text: response }]);
  }

  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />
      <main className="flex-1 p-10">
        <div className="mx-auto max-w-5xl">
          <h1 className="mb-2 text-4xl font-bold">Ledger<span className="text-green-400">AI</span> Data Assistant</h1>
          <p className="mb-8 text-zinc-400">Deterministic answers calculated from your uploaded data; no AI service is connected.</p>
          {!dataset && <div className="mb-6"><FileUpload /></div>}
          {dataset && <p className="mb-6 text-sm text-zinc-400">Using {dataset.uploadedFile.name} · {dataset.summary.rowsAnalyzed} rows analyzed ({dataset.summary.quality} quality).</p>}
          <SuggestedQuestions onSelect={handleSend} />
          <ChatWindow messages={messages} />
          <ChatInput onSend={handleSend} />
        </div>
      </main>
    </div>
  );
}
