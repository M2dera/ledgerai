"use client";

import { useState, type ReactNode } from "react";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import type { JournalEntry } from "@/lib/accounting/types";

type JournalEntryEditorProps = {
  entry: JournalEntry;
  onSave: (entry: JournalEntry) => void;
  error?: string;
  children?: ReactNode;
};

type JournalEntryDraft = {
  baseEntry: JournalEntry;
  date: string;
  description: string;
  currency: string;
  lines: Array<{ accountId: string; debit: string; credit: string }>;
};

const fieldClassName = "w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-white outline-none focus:border-green-500";

export default function JournalEntryEditor({ entry, onSave, error, children }: JournalEntryEditorProps) {
  const [draft, setDraft] = useState<JournalEntryDraft | null>(null);

  // A successful Save replaces the entry. Rejected edits keep its reference and the draft.
  if (!draft || draft.baseEntry !== entry) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDraft({
            baseEntry: entry,
            date: entry.date,
            description: entry.description,
            currency: entry.currency,
            lines: entry.lines.map((line) => ({ accountId: line.accountId, debit: String(line.debit), credit: String(line.credit) })),
          })}
          className="rounded-lg border border-zinc-600 px-4 py-2 font-semibold text-zinc-200 hover:bg-zinc-700"
        >
          Edit
        </button>
        {children}
      </div>
    );
  }

  function updateLine(index: number, field: "accountId" | "debit" | "credit", value: string) {
    setDraft((current) => current ? {
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line),
    } : current);
  }

  return (
    <form
      noValidate
      aria-label="Edit journal entry"
      className="space-y-3 rounded-xl border border-zinc-600 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          id: entry.id,
          date: draft.date,
          description: draft.description,
          currency: draft.currency,
          lines: draft.lines.map((line) => ({
            accountId: line.accountId,
            debit: line.debit.trim() ? Number(line.debit) : Number.NaN,
            credit: line.credit.trim() ? Number(line.credit) : Number.NaN,
          })),
        });
      }}
    >
      <h3 className="font-semibold text-green-300">Edit Journal Entry</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-zinc-300">
          <span className="block">Date</span>
          <input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className={fieldClassName} />
        </label>
        <label className="space-y-1 text-zinc-300">
          <span className="block">Currency</span>
          <input type="text" value={draft.currency} maxLength={3} placeholder="KWD" onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} className={fieldClassName} />
        </label>
      </div>
      <label className="block space-y-1 text-zinc-300">
        <span className="block">Description</span>
        <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} dir="auto" className={fieldClassName} />
      </label>
      <div className="space-y-3" dir="ltr">
        {draft.lines.map((line, index) => (
          <fieldset key={index} className="rounded-lg border border-zinc-700 p-3">
            <legend className="px-1 text-zinc-300">Line {index + 1}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-zinc-300 sm:col-span-2">
                <span className="block">Account</span>
                <select value={line.accountId} onChange={(event) => updateLine(index, "accountId", event.target.value)} className={fieldClassName}>
                  <option value="">Select account</option>
                  {DEFAULT_CHART_OF_ACCOUNTS.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-zinc-300">
                <span className="block">Debit</span>
                <input type="number" min="0" step="0.001" value={line.debit} onChange={(event) => updateLine(index, "debit", event.target.value)} className={fieldClassName} />
              </label>
              <label className="space-y-1 text-zinc-300">
                <span className="block">Credit</span>
                <input type="number" min="0" step="0.001" value={line.credit} onChange={(event) => updateLine(index, "credit", event.target.value)} className={fieldClassName} />
              </label>
            </div>
            <button type="button" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, lineIndex) => lineIndex !== index) })} className="mt-2 text-zinc-400 hover:text-white" aria-label={`Remove line ${index + 1}`}>Remove line</button>
          </fieldset>
        ))}
      </div>
      <button type="button" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { accountId: "", debit: "0", credit: "0" }] })} className="rounded-lg border border-zinc-600 px-3 py-2 text-zinc-200 hover:bg-zinc-700">Add line</button>
      {error && <p role="alert" className="whitespace-pre-line text-red-300">{error}</p>}
      <p className="text-zinc-400">Saving validates the entry and returns it to awaiting approval. Ledger balances change only after posting.</p>
      <div className="flex gap-2">
        <button type="submit" className="rounded-lg bg-green-500 px-4 py-2 font-semibold text-black hover:bg-green-400">Save</button>
        <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-zinc-600 px-4 py-2 font-semibold text-zinc-200 hover:bg-zinc-700">Cancel</button>
      </div>
    </form>
  );
}
