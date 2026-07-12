"use client";

import { useState } from "react";

type ChatInputProps = {
  onSend: (message: string) => void;
};

export default function ChatInput({
  onSend,
}: ChatInputProps) {
  const [message, setMessage] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedMessage = message.trim();

    if (!trimmedMessage) return;

    onSend(trimmedMessage);
    setMessage("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 flex gap-3"
    >
      <input
        type="text"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Ask about your financial data..."
        className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none placeholder:text-zinc-500 focus:border-green-500"
      />

      <button
        type="submit"
        className="rounded-xl bg-green-500 px-6 py-3 font-semibold text-black transition hover:bg-green-400"
      >
        Send
      </button>
    </form>
  );
}