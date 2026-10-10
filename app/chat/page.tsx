"use client";

import { useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/layout/Sidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import ChatInput from "@/components/chat/ChatInput";
import SuggestedQuestions from "@/components/chat/SuggestedQuestions";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import { useAccountingSession } from "@/components/providers/AccountingSessionProvider";
import { approveChatTransaction, editChatTransaction, postChatTransaction, reverseChatTransaction, routeChatMessage } from "@/lib/chat";
import { createSuggestedTransaction } from "@/lib/accounting/transaction-workflow";
import { captureAuditContext } from "@/lib/accounting/audit-trail";
import type { JournalEntry } from "@/lib/accounting/types";
import type { AnalystInterpretation } from "@/lib/ai/types";

export default function ChatPage() {
  const { dataset, isReady } = useLedgerData();
  const { chat, setChat, nextTransactionId } = useAccountingSession();
  const [busy, setBusy] = useState(false);

  async function handleSend(message: string) {
    setChat((current) => ({ ...current, messages: [...current.messages, { sender: "user", text: message }] }));
    try {
      const createdAt = new Date();
      // Proposal metadata only; the message does not establish a transaction date.
      const date = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}-${String(createdAt.getDate()).padStart(2, "0")}`;
      const result = await routeChatMessage(message, dataset, async (request) => {
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
      }, {
        id: () => nextTransactionId("suggestion"),
        date,
        accountingLedger: chat.ledger,
        requestTransactionInterpreter: async (description) => {
          setBusy(true);
          try {
            const response = await fetch("/api/transaction-interpreter", {
              method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
              body: JSON.stringify({ description }),
            });
            const payload: unknown = await response.json();
            if (!response.ok) throw new Error("The local transaction interpreter is unavailable.");
            if (!payload || typeof payload !== "object" || !("candidate" in payload)) throw new Error("Invalid transaction interpretation response");
            return (payload as { candidate: unknown }).candidate;
          } finally {
            setBusy(false);
          }
        },
      });
      if (result.route === "transaction") {
        const transaction = result.status === "suggested"
          ? createSuggestedTransaction(result.suggestion, captureAuditContext())
          : undefined;
        setChat((current) => ({ ...current, messages: [...current.messages, {
          sender: "ai", text: result.text, ...(transaction ? { transaction } : {}),
        }] }));
      }
      else if (result.route === "local") setChat((current) => ({ ...current, messages: [...current.messages, { sender: "ai", text: result.text }] }));
      else setChat((current) => ({ ...current, messages: [...current.messages, { sender: "ai", text: "Local Ollama qualitative interpretation only", interpretation: result.interpretation, facts: result.facts }] }));
    } catch (error) {
      const text = error instanceof Error && error.message ? error.message : "The local Ollama analyst could not respond. Check that Ollama is running and qwen3:8b is available, then retry.";
      setChat((current) => ({ ...current, messages: [...current.messages, { sender: "ai", text }] }));
    }
  }

  function handleApprove(transactionId: string) {
    const auditContext = captureAuditContext();
    setChat((current) => ({ ...current, messages: approveChatTransaction(current.messages, transactionId, auditContext) }));
  }

  function handlePost(transactionId: string) {
    const auditContext = captureAuditContext();
    setChat((current) => postChatTransaction(current, transactionId, auditContext));
  }

  function handleEdit(transactionId: string, entry: JournalEntry) {
    const auditContext = captureAuditContext();
    setChat((current) => editChatTransaction(current, transactionId, entry, auditContext));
  }

  function handleReverse(transactionId: string) {
    const reversalId = nextTransactionId("reversal");
    const auditContext = captureAuditContext();
    setChat((current) => reverseChatTransaction(current, transactionId, reversalId, auditContext));
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
            <h2 id="empty-chat-title" className="text-2xl font-bold">Upload a dataset for financial analysis</h2>
            <p className="mt-2 text-zinc-400">Financial questions use the same dataset as your dashboard. You can describe transactions below without uploading a file.</p>
            <Link href="/" className="mt-5 inline-flex rounded-xl bg-green-500 px-5 py-3 font-semibold text-black hover:bg-green-600">Go to file upload</Link>
          </section>}
          {isReady && <>
            {dataset && <>
              <p className="mb-6 text-sm text-zinc-400">Using {dataset.uploadedFile.name} - {dataset.summary.rowsAnalyzed} rows analyzed ({dataset.summary.quality} quality).</p>
              <SuggestedQuestions onSelect={handleSend} />
            </>}
            <ChatWindow messages={chat.messages} onApprove={handleApprove} onPost={handlePost} onReverse={handleReverse} onEdit={handleEdit} editingError={chat.editingError} />
            {chat.postingError && <p className="my-2 text-sm text-red-300" role="alert">{chat.postingError}</p>}
            {chat.reversalError && <p className="my-2 text-sm text-red-300" role="alert">{chat.reversalError}</p>}
            {busy && <p className="my-2 text-sm text-zinc-400" role="status">Querying local Ollama...</p>}
            <ChatInput onSend={handleSend} />
          </>}
        </div>
      </main>
    </div>
  );
}
