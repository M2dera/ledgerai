import LedgerPageClient from "@/components/ledger/LedgerPageClient";
import { resolveLedgerQuery, type LedgerQueryParameters } from "@/lib/ledger-navigation";

export default async function GeneralLedgerPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<LedgerQueryParameters>;
}) {
  const queryState = resolveLedgerQuery(await searchParams);
  const key = JSON.stringify([queryState.filters, queryState.invalidQueryMessage]);
  return <LedgerPageClient key={key} initialFilters={queryState.filters} initialQueryError={queryState.invalidQueryMessage} />;
}
