"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { getProfitLossReport, type ProfitLossFilters } from "@/lib/profit-loss";
import { getLedgerAccountHref } from "@/lib/ledger-navigation";

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });

function formatAmount(value: number, currency: string | null): string {
  const amount = value !== 0 && Math.abs(value) < 1e-20 ? value.toExponential() : numberFormat.format(value);
  return `${amount}${currency ? ` ${currency}` : ""}`;
}

function periodLabel(startDate: string | null, endDate: string | null): string {
  if (startDate && endDate) return `${startDate} to ${endDate}, inclusive`;
  if (startDate) return `On or after ${startDate}`;
  if (endDate) return `On or before ${endDate}`;
  return "All posted entries";
}

export default function ProfitLossReport({ ledger }: { ledger: AccountingLedgerState | null | undefined }) {
  const [filters, setFilters] = useState<ProfitLossFilters>({});
  const report = useMemo(() => getProfitLossReport(ledger, filters), [ledger, filters]);
  const hasFilters = Boolean(filters.startDate || filters.endDate);
  const controlClass = "mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white scheme-dark focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/40";

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4 text-sm text-zinc-300">
        This report uses posted journal entries from the current session, including posted reversals. Entries remain while you navigate the app and are cleared on page refresh.
      </p>

      <fieldset className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <legend className="px-2 font-semibold">Report period</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-medium text-zinc-300" htmlFor="profit-loss-start-date">
            Start date (inclusive)
            <input id="profit-loss-start-date" type="date" className={controlClass} value={filters.startDate ?? ""} aria-describedby="profit-loss-date-help" onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} />
          </label>
          <label className="text-sm font-medium text-zinc-300" htmlFor="profit-loss-end-date">
            End date (inclusive)
            <input id="profit-loss-end-date" type="date" className={controlClass} value={filters.endDate ?? ""} aria-describedby="profit-loss-date-help" onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} />
          </label>
          <div className="flex items-end">
            <button type="button" disabled={!hasFilters} onClick={() => setFilters({})} className="w-full rounded-lg border border-zinc-700 px-4 py-2 font-semibold text-zinc-200 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-green-400 disabled:cursor-default disabled:opacity-40">Clear dates</button>
          </div>
        </div>
        <p id="profit-loss-date-help" className="mt-3 text-sm text-zinc-400">Filters use journal dates. Leave either date blank for an open boundary, or both blank for all posted entries.</p>
      </fieldset>

      {report.status === "error" ? (
        <section className="rounded-xl border border-red-500/40 bg-red-500/10 p-5" role="alert">
          <h2 className="font-semibold text-red-200">Unable to display Profit &amp; Loss</h2>
          <p className="mt-2 text-sm text-red-200">{report.message}</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="profit-loss-summary-title" className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="profit-loss-summary-title" className="text-lg font-semibold">{periodLabel(report.startDate, report.endDate)}</h2>
              <p className="text-sm text-zinc-300">Currency: <span className="font-semibold text-white">{report.currency ?? "Not established"}</span></p>
            </div>
            <p className="mt-3 text-sm text-zinc-400">{report.includedEntryCount} posted {report.includedEntryCount === 1 ? "entry" : "entries"} included.</p>
            <dl className="mt-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <dt className="text-sm text-zinc-400">Total revenue</dt>
                <dd className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatAmount(report.profitAndLoss.totalRevenue, report.currency)}</dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <dt className="text-sm text-zinc-400">Total expenses</dt>
                <dd className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatAmount(report.profitAndLoss.totalExpenses, report.currency)}</dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <dt className="text-sm text-zinc-400">Net profit / loss</dt>
                <dd className={`mt-2 break-words text-2xl font-semibold tabular-nums ${report.profitAndLoss.netIncome < 0 ? "text-amber-200" : "text-green-300"}`}>{formatAmount(report.profitAndLoss.netIncome, report.currency)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-zinc-400">Net profit or loss is revenue minus expenses. A negative net amount represents a loss.</p>
            <p className="mt-2 text-sm text-zinc-400">Revenue uses credit minus debit; expenses use debit minus credit. Negative account balances are included.</p>
          </section>

          {report.undatedEntryCount > 0 && <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-5 py-4 text-sm text-amber-200" role="status">
            {report.undatedEntryCount} posted {report.undatedEntryCount === 1 ? "entry has" : "entries have"} no valid journal date. Their amounts are included in this all-posted report; period filtering requires valid journal dates.
          </p>}

          {report.postedEntryCount === 0 ? (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6" aria-labelledby="empty-profit-loss-title">
              <h2 id="empty-profit-loss-title" className="text-xl font-semibold">No posted journal entries yet</h2>
              <p className="mt-3 text-zinc-400">Review a transaction in AI Analyst, approve it, then post it. Revenue, expenses, and net profit or loss are currently zero.</p>
              <Link href="/chat" className="mt-5 inline-flex rounded-xl bg-green-500 px-5 py-3 font-semibold text-black hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-300">Open AI Analyst</Link>
            </section>
          ) : !report.hasActivity && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6" role="status">
              <h2 className="text-xl font-semibold">No posted revenue or expense activity</h2>
              <p className="mt-3 text-zinc-400">{hasFilters ? "No revenue or expense movements exist in this period. Choose another period or clear the dates to see all posted activity." : "The posted entries in this session have no revenue or expense movements."}</p>
            </section>
          )}

          <section aria-labelledby="profit-loss-accounts-title">
            <h2 id="profit-loss-accounts-title" className="mb-3 text-lg font-semibold">Account breakdown</h2>
            <div className="overflow-x-auto rounded-xl border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-green-400" tabIndex={0} role="region" aria-label="Scrollable Profit & Loss account breakdown">
              <table className="w-full min-w-[600px] text-left text-sm">
                <caption className="border-b border-zinc-800 bg-zinc-900 px-5 py-4 text-left text-zinc-400">Revenue and expense amounts for {periodLabel(report.startDate, report.endDate)}{report.currency ? ` in ${report.currency}` : ""}. Accounts with zero amounts are included.</caption>
                <thead className="bg-zinc-900 text-zinc-300">
                  <tr>
                    <th scope="col" className="px-5 py-3">Account code</th>
                    <th scope="col" className="px-5 py-3">Account name</th>
                    <th scope="col" className="px-5 py-3">Classification</th>
                    <th scope="col" className="px-5 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 bg-zinc-950">
                  {[...report.profitAndLoss.revenue, ...report.profitAndLoss.expenses].map((line) => <tr key={line.account.id} className="align-top hover:bg-zinc-900/60">
                    <td className="px-5 py-4 font-mono text-zinc-300">{line.account.code}</td>
                    <th scope="row" className="px-5 py-4 font-medium"><Link href={getLedgerAccountHref(line.account.id, { startDate: report.startDate ?? undefined, endDate: report.endDate ?? undefined })} aria-label={`View ${line.account.name} ledger entries`} className="rounded underline decoration-zinc-600 underline-offset-4 hover:text-green-300 hover:decoration-green-300 focus:outline-none focus:ring-2 focus:ring-green-400">{line.account.name}</Link></th>
                    <td className="px-5 py-4 text-zinc-300">{line.account.type === "revenue" ? "Revenue" : "Expense"}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{formatAmount(line.balance, report.currency)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
