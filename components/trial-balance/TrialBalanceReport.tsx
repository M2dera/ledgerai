"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { getTrialBalanceReport } from "@/lib/trial-balance";
import { getLedgerAccountHref } from "@/lib/ledger-navigation";

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });
const accountTypeLabels = { asset: "Asset", liability: "Liability", equity: "Equity", revenue: "Revenue", expense: "Expense" };

function formatAmount(value: number, currency: string | null): string {
  const amount = value !== 0 && Math.abs(value) < 1e-20 ? value.toExponential() : numberFormat.format(value);
  return `${amount}${currency ? ` ${currency}` : ""}`;
}

export default function TrialBalanceReport({ ledger }: { ledger: AccountingLedgerState | null | undefined }) {
  const [asOfDate, setAsOfDate] = useState("");
  const report = useMemo(() => getTrialBalanceReport(ledger, asOfDate), [ledger, asOfDate]);

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4 text-sm text-zinc-300">
        This report uses posted journal entries from the current session. Entries remain while you navigate the app and are cleared on page refresh.
      </p>

      <fieldset className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <legend className="px-2 font-semibold">Report date</legend>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="w-full text-sm font-medium text-zinc-300 sm:max-w-xs" htmlFor="trial-balance-date">
            As of date (inclusive)
            <input id="trial-balance-date" type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} aria-describedby="trial-balance-date-help" className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white scheme-dark focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/40" />
          </label>
          <button type="button" disabled={!asOfDate} onClick={() => setAsOfDate("")} className="rounded-lg border border-zinc-700 px-4 py-2 font-semibold text-zinc-200 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-green-400 disabled:cursor-default disabled:opacity-40">Clear date</button>
        </div>
        <p id="trial-balance-date-help" className="mt-3 text-sm text-zinc-400">Includes all posted entries in this session with journal dates on or before the chosen date. Leave blank for all posted entries.</p>
      </fieldset>

      {report.status === "error" ? (
        <section className="rounded-xl border border-red-500/40 bg-red-500/10 p-5" role="alert">
          <h2 className="font-semibold text-red-200">Unable to display the Trial Balance</h2>
          <p className="mt-2 text-sm text-red-200">{report.message}</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="trial-balance-summary-title" className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="trial-balance-summary-title" className="text-lg font-semibold">{report.asOfDate ? `As of ${report.asOfDate}` : "All posted entries"}</h2>
              <p className="text-sm text-zinc-300">Currency: <span className="font-semibold text-white">{report.currency ?? "Not established"}</span></p>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-zinc-400">{report.includedEntryCount} posted {report.includedEntryCount === 1 ? "entry" : "entries"} included{report.asOfDate ? " through this date, inclusive" : ""}.</p>
              <p role="status" className={`rounded-full border px-3 py-1 text-sm font-semibold ${report.trialBalance.balanced ? "border-green-500/40 bg-green-500/10 text-green-300" : "border-amber-400/40 bg-amber-400/10 text-amber-200"}`}>
                {report.trialBalance.balanced ? "Balanced" : "Out of balance"}
              </p>
            </div>
            <dl className="mt-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <dt className="text-sm text-zinc-400">Total debit balances</dt>
                <dd className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatAmount(report.trialBalance.totalDebits, report.currency)}</dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <dt className="text-sm text-zinc-400">Total credit balances</dt>
                <dd className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatAmount(report.trialBalance.totalCredits, report.currency)}</dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <dt className="text-sm text-zinc-400">Difference</dt>
                <dd className={`mt-2 break-words text-2xl font-semibold tabular-nums ${report.trialBalance.balanced ? "text-green-300" : "text-amber-200"}`}>{formatAmount(report.trialBalance.difference, report.currency)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-zinc-400">Difference is total debit balances minus total credit balances. Each account shows its net debit or credit balance.</p>
            <p className="mt-2 text-sm text-zinc-400">Balanced allows a difference of up to 0.000000001 in the ledger currency.</p>
          </section>

          {report.postedEntryCount === 0 ? (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6" aria-labelledby="empty-trial-balance-title">
              <h2 id="empty-trial-balance-title" className="text-xl font-semibold">No posted journal entries yet</h2>
              <p className="mt-3 text-zinc-400">Review a transaction in AI Analyst, approve it, then post it. All accounts currently have zero balances.</p>
              <Link href="/chat" className="mt-5 inline-flex rounded-xl bg-green-500 px-5 py-3 font-semibold text-black hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-300">Open AI Analyst</Link>
            </section>
          ) : report.includedEntryCount === 0 && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6" role="status">
              <h2 className="text-xl font-semibold">No posted entries on or before this date</h2>
              <p className="mt-3 text-zinc-400">Choose a later date or clear the date to include all posted entries. Account balances are zero for this cutoff.</p>
            </section>
          )}

          <section aria-labelledby="trial-balance-accounts-title">
            <h2 id="trial-balance-accounts-title" className="mb-3 text-lg font-semibold">Account balances</h2>
            <div className="overflow-x-auto rounded-xl border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-green-400" tabIndex={0} role="region" aria-label="Scrollable Trial Balance account balances">
              <table className="w-full min-w-[700px] text-left text-sm">
                <caption className="border-b border-zinc-800 bg-zinc-900 px-5 py-4 text-left text-zinc-400">Account balances {report.asOfDate ? `as of ${report.asOfDate}, inclusive` : "from all posted journal entries"}{report.currency ? ` in ${report.currency}` : ""}. Accounts with zero balances are included.</caption>
                <thead className="bg-zinc-900 text-zinc-300">
                  <tr>
                    <th scope="col" className="px-5 py-3">Account code</th>
                    <th scope="col" className="px-5 py-3">Account name</th>
                    <th scope="col" className="px-5 py-3">Account type</th>
                    <th scope="col" className="px-5 py-3 text-right">Debit balance</th>
                    <th scope="col" className="px-5 py-3 text-right">Credit balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 bg-zinc-950">
                  {report.trialBalance.lines.map((line) => <tr key={line.account.id} className="align-top hover:bg-zinc-900/60">
                    <td className="px-5 py-4 font-mono text-zinc-300">{line.account.code}</td>
                    <th scope="row" className="px-5 py-4 font-medium"><Link href={getLedgerAccountHref(line.account.id, { endDate: report.asOfDate ?? undefined })} aria-label={`View ${line.account.name} ledger entries`} className="rounded underline decoration-zinc-600 underline-offset-4 hover:text-green-300 hover:decoration-green-300 focus:outline-none focus:ring-2 focus:ring-green-400">{line.account.name}</Link></th>
                    <td className="px-5 py-4 text-zinc-300">{accountTypeLabels[line.account.type]}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{formatAmount(line.debitBalance, report.currency)}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{formatAmount(line.creditBalance, report.currency)}</td>
                  </tr>)}
                </tbody>
                <tfoot className="border-t border-zinc-700 bg-zinc-900 font-semibold">
                  <tr>
                    <th scope="row" colSpan={3} className="px-5 py-4">Total balances</th>
                    <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{formatAmount(report.trialBalance.totalDebits, report.currency)}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{formatAmount(report.trialBalance.totalCredits, report.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
