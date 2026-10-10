"use client";

import Sidebar from "@/components/layout/Sidebar";
import ProfitLossReport from "@/components/profit-loss/ProfitLossReport";
import { useAccountingSession } from "@/components/providers/AccountingSessionProvider";

export default function ProfitLossPage() {
  const { chat } = useAccountingSession();

  return (
    <div className="flex min-h-screen flex-col bg-black text-white md:flex-row max-md:[&>aside]:min-h-0 max-md:[&>aside]:w-full max-md:[&>aside]:border-r-0 max-md:[&>aside]:border-b md:[&>aside]:shrink-0">
      <Sidebar />
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-bold md:text-4xl">Profit &amp; Loss</h1>
          <p className="mb-6 mt-2 text-zinc-400">Review revenue, expenses, and net profit or loss from posted entries for your chosen period.</p>
          <ProfitLossReport ledger={chat.ledger} />
        </div>
      </main>
    </div>
  );
}
