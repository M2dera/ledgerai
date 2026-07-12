"use client";

import { useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import ChatInput from "@/components/chat/ChatInput";
import SuggestedQuestions from "@/components/chat/SuggestedQuestions";

type Message = {
  sender: "user" | "ai";
  text: string;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: "ai",
      text: "Hello, Meshal 👋 Ask me anything about your financial data.",
    },
  ]);

  function getAIResponse(message: string) {
  const question = message.toLowerCase();

  if (question.includes("profit")) {
    return "Profit may have decreased because expenses increased faster than revenue. The main areas to review are marketing, operating costs, and cost of goods sold.";
  }

  if (question.includes("expense")) {
    return "Your highest expenses are likely concentrated in operating costs, marketing, and payroll. A detailed category breakdown will help identify the biggest cost drivers.";
  }

  if (question.includes("revenue")) {
    return "Revenue performance appears positive overall. The next step is to compare periods and identify which products, services, or months contributed most to growth.";
  }

  if (question.includes("compare") || question.includes("last month")) {
    return "Compared with last month, LedgerAI will review changes in revenue, expenses, profit, and cash flow, then highlight the most important movements.";
  }

  return "I understand your question. Once your financial file is connected to the chat, I will analyze the data and provide a specific answer based on your numbers.";
}

function handleSend(message: string) {
  const aiResponse = getAIResponse(message);

  setMessages((current) => [
    ...current,
    {
      sender: "user",
      text: message,
    },
    {
      sender: "ai",
      text: "Thinking...",
    },
  ]);

  setTimeout(() => {
    setMessages((current) => {
      const updated = [...current];
      updated[updated.length - 1] = {
        sender: "ai",
        text: aiResponse,
      };
      return updated;
    });
  }, 1000);
}

  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar />

      <main className="flex-1 p-10">
        <div className="mx-auto max-w-5xl">
          <h1 className="mb-2 text-4xl font-bold">
            Ask Ledger<span className="text-green-400">AI</span>
          </h1>

          <p className="mb-8 text-zinc-400">
            Chat with your financial data.
          </p>

          <SuggestedQuestions onSelect={handleSend} />

          <ChatWindow messages={messages} />

          <ChatInput onSend={handleSend} />
        </div>
      </main>
    </div>
  );
}