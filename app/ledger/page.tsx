"use client";

import Sidebar from "@/components/layout/Sidebar";
import GeneralLedger from "@/components/ledger/GeneralLedger";
import { useAccountingSession } from "@/components/providers/AccountingSessionProvider";

export default function GeneralLedgerPage() {
  const { chat } = useAccountingSession();

  return (
    <div className="flex min-h-screen flex-col bg-black text-white md:flex-row max-md:[&>aside]:min-h-0 max-md:[&>aside]:w-full max-md:[&>aside]:border-r-0 max-md:[&>aside]:border-b md:[&>aside]:shrink-0">
      <Sidebar />
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-bold md:text-4xl">General Ledger</h1>
          <p className="mb-6 mt-2 text-zinc-400">Review posted journal lines, filter by account or period, and check account totals.</p>
          <GeneralLedger ledger={chat.ledger} />
        </div>
      </main>
    </div>
  );
}
