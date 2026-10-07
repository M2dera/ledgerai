import type { Account } from "./types";

export const DEFAULT_CHART_OF_ACCOUNTS = [
  { id: "cash", code: "1000", name: "Cash", type: "asset" },
  { id: "bank", code: "1010", name: "Bank", type: "asset" },
  { id: "accounts-receivable", code: "1100", name: "Accounts Receivable", type: "asset" },
  { id: "computer-equipment", code: "1200", name: "Computer Equipment", type: "asset", category: "fixed-assets" },
  { id: "accounts-payable", code: "2000", name: "Accounts Payable", type: "liability" },
  { id: "owners-equity", code: "3000", name: "Owner's Equity", type: "equity" },
  { id: "revenue", code: "4000", name: "Revenue", type: "revenue" },
  { id: "rent-expense", code: "5000", name: "Rent Expense", type: "expense" },
  { id: "salaries-expense", code: "5010", name: "Salaries Expense", type: "expense" },
  { id: "utilities-expense", code: "5020", name: "Utilities Expense", type: "expense" },
] as const satisfies readonly Account[];

export function createAccountMap(accounts: readonly Account[]): ReadonlyMap<string, Account> {
  return new Map(accounts.map((account) => [account.id, account]));
}
