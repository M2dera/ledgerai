"use client";

import { useMemo } from "react";
import Link from "next/link";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import AnalysisCard from "@/components/dashboard/AnalysisCard";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import type { Account } from "@/lib/accounting/types";
import { getDashboardAccountingReport } from "@/lib/dashboard-accounting";
import { getLedgerAccountHref } from "@/lib/ledger-navigation";

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });

function formatAmount(value: number, currency: string): string {
  const amount = value !== 0 && Math.abs(value) < 1e-20 ? value.toExponential() : numberFormat.format(value);
  return `${amount} ${currency}`;
}

export default function AccountingOverview({
  ledger,
  accounts = DEFAULT_CHART_OF_ACCOUNTS,
}: {
  ledger: AccountingLedgerState | null | undefined;
  accounts?: readonly Account[];
}) {
  const report = useMemo(() => getDashboardAccountingReport(ledger, accounts), [ledger, accounts]);

  return (
    <section className="mt-8" aria-labelledby="accounting-overview-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="accounting-overview-title" className="text-xl font-semibold">Posted accounting overview</h2>
        {report.status !== "error" && <p className="text-sm text-zinc-300">Currency: <span className="font-semibold text-white">{report.currency ?? "Not established"}</span></p>}
      </div>
      <p className="mt-2 text-sm text-zinc-300">Period: All posted entries</p>
      <p className="mt-2 text-sm text-zinc-400">KPIs use posted journal entries from this session, including posted reversals. Entries remain while you navigate the app and are cleared on page refresh.</p>

      {report.status === "error" ? (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-5" role="alert">
          <h3 className="font-semibold text-red-200">Unable to display accounting KPIs</h3>
          <p className="mt-2 text-sm text-red-200">{report.message}</p>
        </div>
      ) : report.status === "empty" ? (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-8" role="status">
          <h3 className="text-2xl font-bold">No posted journal entries yet</h3>
          <p className="mt-2 text-zinc-400">Review a transaction in AI Analyst, approve it, then post it to see accounting KPIs here.</p>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm text-zinc-400">{report.postedEntryCount} posted {report.postedEntryCount === 1 ? "entry" : "entries"} included.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <AnalysisCard title="Revenue" value={formatAmount(report.revenue, report.currency)} status={report.revenue > 0 ? "success" : "neutral"} />
            <AnalysisCard title="Expenses" value={formatAmount(report.expenses, report.currency)} status={report.expenses > 0 ? "warning" : "neutral"} />
            <AnalysisCard title="Net profit / loss" value={formatAmount(report.netIncome, report.currency)} status={report.netIncome < 0 ? "danger" : report.netIncome > 0 ? "success" : "neutral"} />
            {report.cashBalance ? (
              <Link href={getLedgerAccountHref(report.cashBalance.account.id)} aria-label="View Cash account ledger entries" className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2 focus:ring-offset-black">
                <AnalysisCard title="Cash balance" value={formatAmount(report.cashBalance.balance, report.currency)} status={report.cashBalance.balance < 0 ? "danger" : "neutral"} />
              </Link>
            ) : <AnalysisCard title="Cash balance" value="Unavailable" />}
            {report.bankBalance ? (
              <Link href={getLedgerAccountHref(report.bankBalance.account.id)} aria-label="View Bank account ledger entries" className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2 focus:ring-offset-black">
                <AnalysisCard title="Bank balance" value={formatAmount(report.bankBalance.balance, report.currency)} status={report.bankBalance.balance < 0 ? "danger" : "neutral"} />
              </Link>
            ) : <AnalysisCard title="Bank balance" value="Unavailable" />}
          </div>
          <p className="mt-3 text-sm text-zinc-400">Cash and Bank are cumulative account balances across all posted entries. Revenue, expenses, and net profit or loss use the same all-posted period as Profit &amp; Loss.</p>
          {(!report.cashBalance || !report.bankBalance) && <p className="mt-2 text-sm text-zinc-400">A Cash or Bank balance is unavailable when its account is not uniquely defined as an asset in the Chart of Accounts.</p>}
          {report.undatedEntryCount > 0 && <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 px-5 py-4 text-sm text-amber-200" role="status">
            {report.undatedEntryCount} posted {report.undatedEntryCount === 1 ? "entry has" : "entries have"} no valid journal date. Their valid amounts are included in this all-posted overview.
          </p>}
        </>
      )}

      <div className="mt-6">
        <Link href="/chat" className="inline-flex rounded-xl border border-green-500/50 px-5 py-3 font-semibold text-green-300 hover:bg-green-500/10 focus:outline-none focus:ring-2 focus:ring-green-400">Open AI Analyst</Link>
      </div>
    </section>
  );
}
