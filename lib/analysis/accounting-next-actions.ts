import { DEFAULT_CHART_OF_ACCOUNTS } from "@/lib/accounting/chart-of-accounts";
import type { AccountingLedgerState } from "@/lib/accounting/transaction-posting";
import type { Account, AccountBalance } from "@/lib/accounting/types";
import type { JournalTransaction } from "@/lib/accounting/transaction-workflow";
import { getBalanceSheetReport } from "@/lib/balance-sheet";
import { getLedgerAccountHref } from "@/lib/ledger-navigation";
import { getProfitLossReport } from "@/lib/profit-loss";
import { getTrialBalanceReport } from "@/lib/trial-balance";

export const ACCOUNTING_ACTION_SOURCE = "Posted accounting entries in this session";

export type AccountingNextAction = {
  id: string;
  title: string;
  reason: string;
  links: readonly { href: string; label: string }[];
};

export type AccountingNextActions =
  | { status: "error"; source: typeof ACCOUNTING_ACTION_SOURCE; message: string; actions: readonly [] }
  | { status: "empty"; source: typeof ACCOUNTING_ACTION_SOURCE; message: string; actions: readonly [] }
  | { status: "ready"; source: typeof ACCOUNTING_ACTION_SOURCE; actions: readonly AccountingNextAction[] };

function amount(value: number, currency: string): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 }).format(value)} ${currency}`;
}

function entryMatches(left: AccountingLedgerState["journalEntries"][number], right: AccountingLedgerState["journalEntries"][number]): boolean {
  return left.id === right.id && left.date === right.date && left.description === right.description && left.currency === right.currency &&
    left.lines.length === right.lines.length && left.lines.every((line, index) => {
      const other = right.lines[index];
      return line.accountId === other.accountId && line.debit === other.debit && line.credit === other.credit;
    });
}

function canonicalBalance(
  id: "accounts-payable" | "accounts-receivable",
  type: "liability" | "asset",
  accounts: readonly Account[],
  balances: readonly AccountBalance[],
): AccountBalance | null {
  const matches = accounts.filter((account) => account.id === id);
  if (matches.length !== 1 || matches[0].type !== type) return null;
  return balances.find(({ account }) => account.id === id) ?? null;
}

function postedReversalActions(
  ledger: Pick<AccountingLedgerState, "journalEntries" | "reversalReferences">,
  transactions: readonly JournalTransaction[],
): AccountingNextAction[] {
  const actions: AccountingNextAction[] = [];
  for (const reference of ledger.reversalReferences) {
    const originals = ledger.journalEntries.filter(({ id }) => id === reference.originalTransactionId);
    const reversals = ledger.journalEntries.filter(({ id }) => id === reference.reversalTransactionId);
    const originalTransactions = transactions.filter(({ suggestion }) => suggestion.entry.id === reference.originalTransactionId);
    const reversalTransactions = transactions.filter(({ suggestion }) => suggestion.entry.id === reference.reversalTransactionId);
    const originalEntry = originals[0];
    const reversalEntry = reversals[0];
    const original = originalTransactions[0];
    const reversal = reversalTransactions[0];
    if (originals.length !== 1 || reversals.length !== 1 || originalTransactions.length !== 1 || reversalTransactions.length !== 1 ||
      !originalEntry || !reversalEntry || !original || !reversal ||
      !entryMatches(originalEntry, original.suggestion.entry) || !entryMatches(reversalEntry, reversal.suggestion.entry) ||
      original?.status !== "reversed" || original.reversedByTransactionId !== reference.reversalTransactionId ||
      reversal?.status !== "posted" || reversal.reversalOfTransactionId !== reference.originalTransactionId) continue;

    actions.push({
      id: `posted-reversal-${reference.reversalTransactionId}`,
      title: "Review the posted reversal and original entry",
      reason: `The session ledger contains posted entries ${reference.originalTransactionId} and ${reference.reversalTransactionId}, linked by the session reversal reference.`,
      links: [
        { href: `/chat#transaction-${encodeURIComponent(reference.originalTransactionId)}`, label: `View original entry ${reference.originalTransactionId}` },
        { href: `/chat#transaction-${encodeURIComponent(reference.reversalTransactionId)}`, label: `View reversal entry ${reference.reversalTransactionId}` },
      ],
    });
  }
  return actions;
}

/** Deterministic, read-only suggestions from validated Accounting Core reports and posted session journals. */
export function getAccountingNextActions(
  ledger: Pick<AccountingLedgerState, "journalEntries" | "reversalReferences"> | null | undefined,
  transactions: readonly JournalTransaction[] = [],
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): AccountingNextActions {
  if (!ledger || !Array.isArray(ledger.journalEntries) || !Array.isArray(ledger.reversalReferences)) {
    return { status: "error", source: ACCOUNTING_ACTION_SOURCE, message: "The session ledger is unavailable.", actions: [] };
  }
  if (ledger.journalEntries.length === 0) {
    return { status: "empty", source: ACCOUNTING_ACTION_SOURCE, message: "There are no posted entries in this session yet, so there is not enough accounting data to suggest a next action.", actions: [] };
  }

  const trialBalance = getTrialBalanceReport(ledger);
  const profitLoss = getProfitLossReport(ledger, {}, accounts);
  const balanceSheet = getBalanceSheetReport(ledger, undefined, accounts);
  const error = [trialBalance, profitLoss, balanceSheet].find((report) => report.status === "error");
  if (error?.status === "error") {
    return { status: "error", source: ACCOUNTING_ACTION_SOURCE, message: error.message, actions: [] };
  }
  if (trialBalance.status !== "ready" || profitLoss.status !== "ready" || balanceSheet.status !== "ready") {
    return { status: "error", source: ACCOUNTING_ACTION_SOURCE, message: "Accounting reports could not be validated safely.", actions: [] };
  }

  const currency = trialBalance.currency;
  if (!currency || profitLoss.currency !== currency || balanceSheet.currency !== currency) {
    return { status: "error", source: ACCOUNTING_ACTION_SOURCE, message: "A single validated report currency is required to suggest accounting actions.", actions: [] };
  }

  const actions: AccountingNextAction[] = [];
  if (!trialBalance.trialBalance.balanced) {
    actions.push({
      id: "trial-balance-discrepancy",
      title: "Investigate the Trial Balance difference",
      reason: `The posted Trial Balance reports a debit-minus-credit difference of ${amount(trialBalance.trialBalance.difference, currency)}.`,
      links: [{ href: "/trial-balance", label: "Review Trial Balance" }],
    });
  }

  const payable = canonicalBalance("accounts-payable", "liability", accounts, balanceSheet.balanceSheet.liabilities);
  if (payable && payable.balance !== 0) {
    actions.push({
      id: "accounts-payable-balance",
      title: "Review Accounts Payable",
      reason: `The posted Accounts Payable balance is ${amount(payable.balance, currency)}.`,
      links: [{ href: getLedgerAccountHref(payable.account.id), label: "View Accounts Payable ledger" }],
    });
  }

  const receivable = canonicalBalance("accounts-receivable", "asset", accounts, balanceSheet.balanceSheet.assets);
  if (receivable && receivable.balance !== 0) {
    actions.push({
      id: "accounts-receivable-balance",
      title: "Review Accounts Receivable",
      reason: `The posted Accounts Receivable balance is ${amount(receivable.balance, currency)}.`,
      links: [{ href: getLedgerAccountHref(receivable.account.id), label: "View Accounts Receivable ledger" }],
    });
  }

  if (profitLoss.profitAndLoss.totalExpenses > profitLoss.profitAndLoss.totalRevenue) {
    actions.push({
      id: "expenses-exceed-revenue",
      title: "Review the expense breakdown",
      reason: `Posted expenses of ${amount(profitLoss.profitAndLoss.totalExpenses, currency)} exceed posted revenue of ${amount(profitLoss.profitAndLoss.totalRevenue, currency)}.`,
      links: [{ href: "/profit-loss", label: "Review Profit & Loss" }],
    });
  }

  actions.push(...postedReversalActions(ledger, transactions));
  return { status: "ready", source: ACCOUNTING_ACTION_SOURCE, actions };
}
