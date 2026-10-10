"use client";

import Sidebar from "@/components/layout/Sidebar";
import BalanceSheetReport from "@/components/balance-sheet/BalanceSheetReport";
import { useAccountingSession } from "@/components/providers/AccountingSessionProvider";

export default function BalanceSheetPage() {
  const { chat } = useAccountingSession();

  return (
    <div className="flex min-h-screen flex-col bg-black text-white md:flex-row max-md:[&>aside]:min-h-0 max-md:[&>aside]:w-full max-md:[&>aside]:border-r-0 max-md:[&>aside]:border-b md:[&>aside]:shrink-0">
      <Sidebar />
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-bold md:text-4xl">Balance Sheet</h1>
          <p className="mb-6 mt-2 text-zinc-400">Review assets, liabilities, and equity from posted entries through your chosen journal date.</p>
          <BalanceSheetReport ledger={chat.ledger} />
        </div>
      </main>
    </div>
  );
}
