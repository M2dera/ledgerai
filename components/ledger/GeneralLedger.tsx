"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { getGeneralLedgerView, type GeneralLedgerFilters } from "@/lib/general-ledger";

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 9 });

function formatAmount(value: number, currency: string | null): string {
  return `${numberFormat.format(value)}${currency ? ` ${currency}` : ""}`;
}

export default function GeneralLedger({
  ledger,
  initialFilters = {},
  initialQueryError = null,
}: {
  ledger: AccountingLedgerState | null | undefined;
  initialFilters?: GeneralLedgerFilters;
  initialQueryError?: string | null;
}) {
  const [filters, setFilters] = useState<GeneralLedgerFilters>(() => initialFilters);
  const [queryError, setQueryError] = useState<string | null>(() => initialQueryError);
  const view = useMemo(() => getGeneralLedgerView(ledger, filters), [ledger, filters]);
  const hasFilters = Boolean(filters.accountId || filters.startDate || filters.endDate || queryError);
  const controlClass = "mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/40";

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4 text-sm text-zinc-300">
        This ledger contains posted journal entries only. Entries stay available while you navigate the app and are cleared on page refresh.
      </p>

      <fieldset className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <legend className="px-2 font-semibold">Filter journal lines</legend>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-medium text-zinc-300" htmlFor="ledger-account">
            Account
            <select id="ledger-account" className={controlClass} value={filters.accountId ?? ""} onChange={(event) => {
              setFilters((current) => ({ ...current, accountId: event.target.value }));
              setQueryError(null);
            }}>
              <option value="">All accounts</option>
              {DEFAULT_CHART_OF_ACCOUNTS.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-zinc-300" htmlFor="ledger-start-date">
            Start date (inclusive)
            <input id="ledger-start-date" type="date" className={`${controlClass} scheme-dark`} value={filters.startDate ?? ""} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} />
          </label>
          <label className="text-sm font-medium text-zinc-300" htmlFor="ledger-end-date">
            End date (inclusive)
            <input id="ledger-end-date" type="date" className={`${controlClass} scheme-dark`} value={filters.endDate ?? ""} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} />
          </label>
          <div className="flex items-end">
            <button type="button" disabled={!hasFilters} onClick={() => {
              setFilters({});
              setQueryError(null);
            }} className="w-full rounded-lg border border-zinc-700 px-4 py-2 font-semibold text-zinc-200 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-green-400 disabled:cursor-default disabled:opacity-40">Clear filters</button>
          </div>
        </div>
      </fieldset>

      {queryError ? (
        <section className="rounded-xl border border-red-500/40 bg-red-500/10 p-5" role="alert">
          <h2 className="font-semibold text-red-200">Unable to apply the General Ledger link</h2>
          <p className="mt-2 text-sm text-red-200">{queryError}</p>
        </section>
      ) : view.status === "error" ? (
        <section className="rounded-xl border border-red-500/40 bg-red-500/10 p-5" role="alert">
          <h2 className="font-semibold text-red-200">Unable to display the General Ledger</h2>
          <p className="mt-2 text-sm text-red-200">{view.message}</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="ledger-summary-title" className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="ledger-summary-title" className="text-lg font-semibold">{view.selectedAccountBalance ? `${view.selectedAccountBalance.account.name} totals` : "All account totals"}</h2>
              <p className="text-sm text-zinc-300">Currency: <span className="font-semibold text-white">{view.currency ?? "Not established"}</span></p>
            </div>
            <p className="mt-2 text-sm text-zinc-400">{view.hasDateFilter ? "For the selected period." : "For all posted entries."}</p>
            <dl className={`mt-5 grid gap-4 sm:grid-cols-2 ${view.selectedAccountBalance ? "lg:grid-cols-3" : ""}`}>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <dt className="text-sm text-zinc-400">Debit total</dt>
                <dd className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatAmount(view.selectedAccountBalance?.debitTotal ?? view.totals.debitTotal, view.currency)}</dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <dt className="text-sm text-zinc-400">Credit total</dt>
                <dd className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatAmount(view.selectedAccountBalance?.creditTotal ?? view.totals.creditTotal, view.currency)}</dd>
              </div>
              {view.selectedAccountBalance && <div className="rounded-lg border border-green-500/30 bg-zinc-950 p-4">
                <dt className="text-sm text-zinc-400">{view.hasDateFilter ? "Period balance" : "Account balance"}</dt>
                <dd className="mt-2 break-words text-2xl font-semibold text-green-300 tabular-nums">{formatAmount(view.selectedAccountBalance.balance, view.currency)}</dd>
              </div>}
            </dl>
            {view.selectedAccountBalance && <p className="mt-4 text-sm text-zinc-400">
              {view.selectedAccountBalance.account.type === "asset" || view.selectedAccountBalance.account.type === "expense"
                ? "This account has a normal debit balance: debit total minus credit total."
                : "This account has a normal credit balance: credit total minus debit total."}
              {view.hasDateFilter && " Period balance includes only entries in this period; it excludes the opening balance."}
            </p>}
          </section>

          {view.undatedEntryCount > 0 && <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-5 py-4 text-sm text-amber-200" role="status">
            {view.undatedEntryCount} posted {view.undatedEntryCount === 1 ? "entry has" : "entries have"} no valid calendar date. {view.hasDateFilter ? "These entries are excluded from the selected period and its totals." : "Their lines and amounts are included and marked Date unavailable."}
          </p>}

          {view.postedEntryCount === 0 ? (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-8" aria-labelledby="empty-ledger-title">
              <h2 id="empty-ledger-title" className="text-2xl font-bold">No posted journal entries yet</h2>
              <p className="mt-3 text-zinc-400">Review a transaction in AI Analyst, approve it, then post it to this session ledger.</p>
              <Link href="/chat" className="mt-5 inline-flex rounded-xl bg-green-500 px-5 py-3 font-semibold text-black hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-300">Open AI Analyst</Link>
            </section>
          ) : view.rows.length === 0 ? (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-8" role="status">
              <h2 className="text-xl font-semibold">No journal lines match these filters</h2>
              <p className="mt-3 text-zinc-400">Choose another account or period, or clear the filters to see all posted lines.</p>
            </section>
          ) : (
            <section aria-labelledby="ledger-entries-title">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 id="ledger-entries-title" className="text-lg font-semibold">Posted journal lines</h2>
                <p className="text-sm text-zinc-400" role="status">{view.rows.length} {view.rows.length === 1 ? "line" : "lines"} shown</p>
              </div>
              <div className="overflow-x-auto rounded-xl border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-green-400" tabIndex={0} role="region" aria-label="Scrollable posted journal lines">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <caption className="border-b border-zinc-800 bg-zinc-900 px-5 py-4 text-left text-zinc-400">Posted journal-entry lines{view.currency ? ` in ${view.currency}` : ""}. Original entries and posted reversals are shown separately.</caption>
                  <thead className="bg-zinc-900 text-zinc-300">
                    <tr>
                      <th scope="col" className="px-5 py-3">Date</th>
                      <th scope="col" className="px-5 py-3">Transaction ID</th>
                      <th scope="col" className="px-5 py-3">Description</th>
                      <th scope="col" className="px-5 py-3">Account</th>
                      <th scope="col" className="px-5 py-3 text-right">Debit</th>
                      <th scope="col" className="px-5 py-3 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 bg-zinc-950">
                    {view.rows.map((row) => <tr key={row.key} className="align-top hover:bg-zinc-900/60">
                      <td className="whitespace-nowrap px-5 py-4 text-zinc-300">{row.date ?? "Date unavailable"}</td>
                      <td className="max-w-56 break-words px-5 py-4 font-mono text-xs text-zinc-300">{row.transactionId}</td>
                      <td className="min-w-56 max-w-96 break-words px-5 py-4 text-zinc-300">{row.description || "Description unavailable"}</td>
                      <td className="px-5 py-4"><span className="font-medium">{row.account.name}</span><span className="mt-1 block text-xs text-zinc-400">{row.account.code}</span></td>
                      <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{formatAmount(row.debit, view.currency)}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{formatAmount(row.credit, view.currency)}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
