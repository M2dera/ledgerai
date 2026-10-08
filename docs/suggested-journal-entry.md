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

## Chat integration

The existing `/chat` page calls `routeChatMessage` in `lib/chat.ts` locally:
message → `parseTransactionIntent` → `suggestJournalEntry` → Accounting Core
validation → a transient chat suggestion. Valid entries display the original
transaction, named debit/credit lines with the exact amount and currency, and
**Awaiting approval**. Users can explicitly approve a reviewed suggestion and
then separately post it to the session ledger. Neither action persists data.

The chat page supplies a session-only proposal ID and its local creation date
as mapper metadata. This date is not evidence of the transaction's accounting
date. Suggestions exist only in React state and disappear when the page is left
or reloaded. Uploaded financial data is never changed; ledger balances change
only through the explicit **Post** action.

Unresolved messages show clarifications from the parser's issue codes. For
`دفعت إيجار 600 د.ك`, the response is
`من أي حساب تم الدفع: البنك أم الصندوق؟`; no account or entry is invented.
Invalid or unsupported transaction attempts stay local and produce no suggestion.
Transactions can be described without uploading a dataset. Financial questions
continue through the unchanged `routeFinancialQuestion` path; only existing
interpretive/recommendation questions call `/api/analyst`.

`tests/chat-transactions.test.ts` covers routing, mappings, clarifications,
financial compatibility, validation failure, and absence of posting/persistence.
`tests/chat-display.test.ts` covers suggestion/clarification display, accounting
precision, and chat availability without a dataset.

## Phase 2: transaction approval workflow

`lib/accounting/transaction-workflow.ts` wraps the existing
`SuggestedJournalEntry` in a transient `JournalTransaction` with one of four
states: `draft`, `awaiting_approval`, `approved`, or `posted`.

- `createDraftTransaction(suggestion)` creates a proposal before review.
- `createSuggestedTransaction(suggestion)` accepts a proposal already validated
  by the suggestion engine and starts it in `awaiting_approval`. Chat uses this
  constructor for every successful suggestion.
- `transitionJournalTransaction(transaction, nextStatus, accounts?)` allows only
  `draft → awaiting_approval` and `awaiting_approval → approved`. It reuses the
  Accounting Core validator; invalid entries or transitions are rejected. A
  custom chart can be supplied, otherwise the existing default chart is used.
  It cannot change status to `posted`; that requires the ledger-aware posting
  function described below.

The original transaction and journal lines remain visible for review. Clicking
**Approve** changes that specific suggestion's status to **Approved** and removes
its approval button. Drafts cannot be approved before review. Repeated or stale
clicks do not change an already approved transaction.

Approval changes only workflow status and preserves the exact suggestion,
intent, entry, amount, currency, accounts, and journal lines. Approved means
reviewed and accepted; it does not mean posted. All states remain in React memory
and disappear on navigation or reload. Approval makes no storage or network
calls and does not update the ledger, balances, or financial statements.

`tests/transaction-workflow.test.ts` covers the state model, valid and invalid
transitions, unchanged accounting data, isolated chat approvals, financial Q&A
compatibility, and absence of posting/persistence. `tests/chat-display.test.ts`
also covers the explicit button action and the updated status display.

## Phase 2: explicit posting

`postJournalTransaction(transaction, ledger, accounts?)` in
`lib/accounting/transaction-posting.ts` performs `approved → posted`. It rejects
drafts, suggestions awaiting approval, already posted transactions, invalid
entries, and an ID already present in the ledger, including a stale approved
copy with the same ID. It never edits the original suggestion or journal entry.

The session ledger starts empty and contains only explicitly posted journal
entries. Uploaded financial summaries are not used as opening balances because
they do not establish complete journal entries. Existing financial Q&A continues
to use the uploaded dataset unchanged.

Before returning a posted transaction, the function derives the complete next
ledger state through the existing `calculateAccountBalances`, `createTrialBalance`,
`classifyProfitAndLoss`, and `classifyBalanceSheet` functions. Core validation
remains authoritative and its mixed-currency rule rejects different currencies
within one ledger. There is no conversion, rounding, account substitution, or
separate financial calculation system. Any failure leaves the previous ledger
and transaction unchanged.

The chat shows **Post** only for approved entries. Clicking it atomically updates
the message status and ledger snapshot in the same React state update. Success
shows **Posted** and a confirmation, with no further approval or posting button.
Failure shows an error and retains the previous state. Duplicate clicks cannot
append a second entry or double the balances.

Posting remains session-only: messages, entries, balances, trial balance, and
statement snapshots disappear on navigation or reload. It makes no storage or
network calls. Reverse, void, audit trails, and ledger/statement UIs
remain outside this implementation.

`tests/transaction-posting.test.ts` covers posting guards, accounting snapshots,
unchanged journal evidence, duplicate prevention, currency rejection, atomic
chat updates, financial Q&A compatibility, and absence of persistence.
`tests/chat-display.test.ts` covers the Post action and its status/confirmation.

## Phase 2: edit journal entry before posting

Chat offers **Edit** for entries awaiting approval or already approved. The form
holds a separate draft of the date, description, currency, accounts, and journal
lines. **Cancel** discards the draft. **Save** applies changes only after all
validation succeeds; an error retains the draft and leaves the saved entry intact.
Approve and Post are hidden while the form is open.

`editJournalTransaction(transaction, entry, ledger, accounts?)` in
`lib/accounting/transaction-editing.ts` validates the unchanged transaction ID,
calendar date, description, and all journal lines through the Accounting Core.
It rejects invalid amounts, unbalanced entries, unknown accounts, invalid currency
codes, and currency incompatible with the posted session ledger. Lines use the
single entry currency. A valid alternate currency is allowed while the ledger is
empty. Accepted entries and lines are copied so later draft changes cannot mutate
the saved entry. The original transaction intent remains visible as source evidence.

- A valid edit to `awaiting_approval` stays `awaiting_approval`.
- A valid edit to `approved` returns to `awaiting_approval`, requiring approval again.
- `posted` entries cannot be edited and never show an Edit action. The ledger ID
  guard also rejects edits from stale unposted copies of a posted transaction.

`editChatTransaction(state, transactionId, entry)` applies the validated edit to
exactly one matching chat message. Success and rejection retain the exact ledger
snapshot: entries, balances, trial balance, and financial statements do not change.
Only subsequent explicit approval and posting can update the ledger, using the
edited entry's data and original ID. Financial Q&A still uses the uploaded dataset.

Editing makes no storage or network calls and is discarded on navigation or reload.
`tests/transaction-editing.test.ts` covers validation, immutable updates, status
reset, ID preservation, unchanged balances, and later approval/posting.
`tests/journal-entry-editor.test.ts` covers Edit visibility, draft handling,
validation errors, Save, and Cancel. Existing posting and financial tests remain
regression coverage.
