"use client";

import { useRef, useState, type SyntheticEvent } from "react";
import type { JournalEntry } from "@/lib/accounting/types";
import {
  createDeterministicEntryExplanation,
  createEntryExplanation,
  createEntryExplanationFacts,
  type EntryExplanation,
} from "@/lib/accounting/entry-explanation";

export default function EntryExplanation({ entry }: { entry: JournalEntry }) {
  const facts = createEntryExplanationFacts(entry);
  const fallback = facts ? createDeterministicEntryExplanation(facts) : undefined;
  const [explanation, setExplanation] = useState<EntryExplanation | undefined>(fallback);
  const requested = useRef(false);

  if (!facts || !fallback) return null;
  const validatedFacts = facts;

  async function requestExplanation(event: SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || requested.current) return;
    requested.current = true;
    try {
      const response = await fetch("/api/entry-explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ entry }),
      });
      if (!response.ok) return;
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || !("explanation" in payload)) return;
      const value = (payload as { explanation?: unknown }).explanation;
      if (!value || typeof value !== "object" || !("lines" in value)) return;
      const validated = createEntryExplanation((value as { lines?: unknown }).lines, validatedFacts);
      if (validated) setExplanation(validated);
    } catch {
      // The deterministic explanation remains visible when the optional local service is unavailable.
    }
  }

  return (
    <details onToggle={requestExplanation} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-400">
        Why this entry?
      </summary>
      <div className="mt-2 space-y-2 text-zinc-400">
        <p>Informational explanation based on the Chart of Accounts classification.</p>
        <ul className="space-y-2">
          {explanation?.lines.map((line) => {
            const fact = validatedFacts.find((item) => item.accountId === line.accountId && item.side === line.side);
            if (!fact) return null;
            return <li key={`${line.accountId}-${line.side}`}><span className="text-zinc-200">{fact.accountName}</span>: {line.explanation}</li>;
          })}
        </ul>
      </div>
    </details>
  );
}
