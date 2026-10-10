"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import type { JournalTransaction } from "@/lib/accounting/transaction-workflow";
import { getAccountingNextActions } from "@/lib/analysis/accounting-next-actions";

export default function AccountingNextActions({
  ledger,
  transactions,
}: {
  ledger: AccountingLedgerState | null | undefined;
  transactions: readonly JournalTransaction[];
}) {
  const result = useMemo(() => getAccountingNextActions(ledger, transactions), [ledger, transactions]);

  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-6" aria-labelledby="accounting-next-actions-title">
      <h2 id="accounting-next-actions-title" className="text-xl font-semibold">Suggested next actions</h2>
      <p className="mt-2 text-sm text-zinc-400">Source: {result.source}. Suggestions are based on posted session accounting entries.</p>
      {result.status === "empty" ? (
        <p className="mt-4 text-sm text-zinc-300" role="status">{result.message}</p>
      ) : result.status === "error" ? (
        <p className="mt-4 text-sm text-amber-200" role="status">Suggestions are unavailable: {result.message}</p>
      ) : result.actions.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-300" role="status">No next actions are indicated by the validated posted accounting entries.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {result.actions.map((action) => (
            <li key={action.id} className="rounded-lg border border-zinc-700 bg-black/30 p-4">
              <h3 className="font-semibold text-white">{action.title}</h3>
              <p className="mt-1 text-sm text-zinc-300">{action.reason}</p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {action.links.map((link) => (
                  <Link key={link.href} href={link.href} className="text-sm font-semibold text-green-300 underline decoration-green-500/60 underline-offset-4 hover:text-green-200 focus:outline-none focus:ring-2 focus:ring-green-400">
                    {link.label}
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
