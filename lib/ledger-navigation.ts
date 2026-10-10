import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import type { GeneralLedgerFilters } from "@/lib/general-ledger";

export type LedgerQueryParameters = Record<string, string | string[] | undefined>;

export type LedgerQueryState = {
  filters: GeneralLedgerFilters;
  invalidQueryMessage: string | null;
};

function readSingleParameter(value: string | string[] | undefined): { value: string | undefined; repeated: boolean } {
  if (Array.isArray(value)) return { value: undefined, repeated: true };
  return { value, repeated: false };
}

/** Build a stable General Ledger link from a Chart of Accounts ID and the originating report dates. */
export function getLedgerAccountHref(
  accountId: string,
  filters: Pick<GeneralLedgerFilters, "startDate" | "endDate"> = {},
): string {
  const query = new URLSearchParams({ accountId });
  if (filters.startDate) query.set("startDate", filters.startDate);
  if (filters.endDate) query.set("endDate", filters.endDate);
  return `/ledger?${query.toString()}`;
}

/** Parse direct General Ledger links without ever treating an unknown account as an unfiltered request. */
export function resolveLedgerQuery(parameters: LedgerQueryParameters): LedgerQueryState {
  const account = readSingleParameter(parameters.accountId);
  const startDate = readSingleParameter(parameters.startDate);
  const endDate = readSingleParameter(parameters.endDate);
  const filters: GeneralLedgerFilters = {};

  if (account.value) {
    const match = DEFAULT_CHART_OF_ACCOUNTS.find(({ id }) => id === account.value);
    if (match) filters.accountId = match.id;
    else return { filters, invalidQueryMessage: "This account filter is not in the Chart of Accounts. Choose a valid account or clear the filters." };
  } else if (parameters.accountId !== undefined) {
    return { filters, invalidQueryMessage: "This account filter is invalid. Choose a valid account or clear the filters." };
  }

  if (account.repeated || startDate.repeated || endDate.repeated) {
    return { filters, invalidQueryMessage: "A General Ledger filter was repeated. Choose one account and one value for each date." };
  }
  if (startDate.value) filters.startDate = startDate.value;
  if (endDate.value) filters.endDate = endDate.value;
  return { filters, invalidQueryMessage: null };
}
