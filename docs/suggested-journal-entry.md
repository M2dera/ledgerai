# Suggested Journal Entry mapping

`suggestJournalEntry(intent, options)` is a pure TypeScript function exported from
`lib/accounting`. It maps the fields of a resolved `TransactionIntent` to a
candidate `JournalEntry`, calls the existing `validateJournalEntry` function, and
returns a suggestion only when validation succeeds. It does not post entries,
update the ledger, persist data, access browser APIs, or call an AI provider.

## API and provenance

```ts
const parsed = parseTransactionIntent("دفعت إيجار 600 د.ك من البنك");
if (parsed.status === "resolved") {
  const result = suggestJournalEntry(parsed.intent, {
    id: "suggestion-1",
    date: "2026-10-08",
    // accounts: a caller-supplied chart; defaults to DEFAULT_CHART_OF_ACCOUNTS
  });
}
```

`SuggestedJournalEntryOptions` requires the entry `id` and a real calendar date
in `YYYY-MM-DD` format. The intent has no transaction date or ID, so the mapper
does not invent one, read a clock, or generate a UUID. Missing metadata stays
unresolved and malformed dates are rejected.

- Success: `{ status: "suggested", suggestion: { entry, intent }, issues: [] }`.
- Failure: `{ status: "unresolved" | "rejected", intent, issues }`, with at least
  one explicit issue and no entry or suggestion.
- `suggestion.intent` is the original intent object reference. The candidate uses
  its exact amount, currency, and description. Source/destination hints and any
  counterparty evidence remain available through that reference.
- The function never mutates the intent, caller metadata, or selected chart.
  It maps structured evidence, without reparsing the description.

## Exact mappings

All entries contain two lines: the full positive amount debited once and credited
once, with zero on the opposite side of each line. There is no currency conversion,
rounding, split payment, or account substitution.

| Intent | Required primary category and hint | Debit account | Credit account |
| --- | --- | --- | --- |
| `expense_payment` | `rent` → `rent-expense`; `salaries` → `salaries-expense`; `utilities` → `utilities-expense` | The matching expense account | Explicit source: `bank` or `cash` |
| `expense_on_account` | Same expense categories and matching hints | The matching expense account | `accounts-payable` |
| `revenue_receipt` | `services` and primary hint `revenue` | Explicit destination: `bank` or `cash` | `revenue` |
| `revenue_on_account` | `services` and primary hint `revenue` | `accounts-receivable` | `revenue` |
| `asset_purchase` | `laptop` or `computer`, with primary hint `computer-equipment` | `computer-equipment` | Explicit source: `bank` or `cash` |
| `owner_investment` | Primary hint `owners-equity`; no category | Explicit destination: `bank` or `cash` | `owners-equity` |

Expense primary accounts must have type `expense`; Revenue type `revenue`;
Owner's Equity type `equity`; Accounts Payable type `liability`; and Accounts
Receivable, Computer Equipment, Bank, and Cash type `asset`. Each provided hint
must agree with both the mapping and the account type.

Computer Equipment is the one added default account: ID `computer-equipment`,
code `1200`, name `Computer Equipment`, type `asset`, optional category
`fixed-assets`. The five standard account types remain unchanged. The category
provides classification metadata; it introduces no hierarchy or separate
`fixed-assets` account type. A custom chart needs the same supported ID and
expected asset type; the optional classification does not select an account.

The Transaction Intent grammar is unchanged. Its asset mapping now supplies the
Computer Equipment hint for existing explicit laptop/computer clauses. Unknown
assets remain unsupported and an asset purchase without a source stays unresolved.
See [Transaction Intent v1](transaction-intent-v1.md) for exact parser clauses.

## Failure rules

- Missing category, primary account hint, payment source, or receiving account
  stays unresolved. A category without its primary hint is insufficient for this
  mapper; an account hint without its required category is also insufficient.
- Unsupported categories/accounts and conflicting category/account hints are
  rejected. Payment accounts are limited to explicitly evidenced `bank` or `cash`.
  A customer/supplier mention never selects either.
- A destination on an outgoing payment, a source on an incoming receipt, or any
  payment account on an on-account intent is contradictory evidence and rejected.
- All selected account IDs must exist exactly once in the supplied chart and
  have the expected type. Missing IDs, duplicates, and wrong types are rejected.
  An explicit empty or incomplete chart never falls back to the default chart.
  Account display names are not used to identify or fabricate accounts.
- Amounts must be positive finite numbers within `Number.MAX_SAFE_INTEGER`.
  Invalid input types and non-string categories are rejected without coercion.
  Currency is required, preserved, and never trimmed or guessed. Whitespace around
  currency is rejected; the existing core validates uppercase currency code format.
- Every otherwise complete candidate is passed to `validateJournalEntry` with
  the selected chart. A core rejection returns `ACCOUNTING_VALIDATION_FAILED`
  with the original `validationErrors` and no suggestion. The existing validator
  itself is unchanged.

## Examples

The examples below assume caller-supplied entry ID/date.

| Description | Suggested lines or unresolved reason |
| --- | --- |
| `دفعت إيجار 600 د.ك من البنك` | Dr Rent Expense 600; Cr Bank 600; KWD |
| `استلمت فاتورة كهرباء 120 د.ك وما دفعتها` | Dr Utilities Expense 120; Cr Accounts Payable 120; KWD |
| `received 2,000 USD from customer for services into bank` | Dr Bank 2,000; Cr Revenue 2,000; USD |
| `بعت للعميل خدمة بـ 2,000 د.ك وما استلمت المبلغ` | Dr Accounts Receivable 2,000; Cr Revenue 2,000; KWD |
| `اشتريت لابتوب بـ 300 د.ك من البنك` | Dr Computer Equipment 300; Cr Bank 300; KWD |
| `bought a computer 300 KWD from bank` | Dr Computer Equipment 300; Cr Bank 300; KWD |
| `ضخيت 5,000 د.ك في الشركة في البنك` | Dr Bank 5,000; Cr Owner's Equity 5,000; KWD |
| `ضخيت 5,000 د.ك في الشركة` | Unresolved: destination account missing |
| `دفعت إيجار 600 د.ك` | Unresolved: source account missing |
| `دفعت 600 د.ك من البنك` | Unresolved: category and primary account hint missing |
| `استلمت من العميل 2,000 د.ك` | Parser remains unresolved: revenue context and destination missing |

`tests/suggested-journal-entry.test.ts` covers end-to-end mappings, missing and
contradictory evidence, supplied-chart safety, amount/currency/provenance
preservation, input immutability, and real Accounting Core validator calls/failure
propagation. Existing valid parser fixtures remain in `tests/transaction-intent.test.ts`,
with asset-specific compatibility coverage added for the new default account.
