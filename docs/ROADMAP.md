# LedgerAI Roadmap

## ✅ Phase 0 — Foundation

Completed:

- Project setup
- GitHub repository
- Excel / CSV ingestion
- Financial data parsing
- Currency detection and validation
- Deterministic financial analysis
- Financial facts
- Dashboard
- Sidebar / navigation
- KPI cards
- Charts foundation
- AI Analyst foundation
- Local Ollama integration
- Arabic deterministic financial questions
- Validation and automated tests

## ✅ Phase 1 — Accounting Engine

Completed:

- Chart of Accounts
- Journal Entry data model
- Journal entry validation
- Ledger
- Trial Balance foundation
- Profit & Loss foundation
- Balance Sheet foundation
- Financial Data → Accounting Core integration
- Transaction Intent Engine
- Suggested Journal Entry engine
- Chat → Transaction Intent → Suggested Journal Entry → Accounting Validation
- Arabic and English transaction recognition
- Missing-account clarification
- `Awaiting approval` state
- Phase 1 scope: suggestions only; no posting / persistence

Important examples already working:

- `دفعت إيجار 600 د.ك من البنك`\
  → Debit Rent Expense / Credit Bank
- `دفعت إيجار 600 د.ك`\
  → asks whether payment was from Bank or Cash
- `استلمت فاتورة كهرباء 120 د.ك وما دفعتها`\
  → Debit Utilities Expense / Credit Accounts Payable
- `كم صافي الربح؟`\
  → deterministic financial analysis remains intact

## 🚧 Phase 2 — Accounting Workflow

In progress. Transaction approval, editing before posting, explicit posting to the session ledger, reversal of posted entries, and a session-only audit trail are complete.

Completed:

- Draft transaction state
- Suggested transaction state (`awaiting_approval`)
- Review workflow
- Approve transaction
- Approved state
- Post journal entry
- Posted state
- Duplicate-posting prevention
- Posted ledger updates
- Trial Balance updates after posting
- Financial statement updates through the Accounting Core
- Edit unposted journal entries with full validation before saving
- Edited approved entries return to `awaiting_approval`
- Transaction ID preservation and unchanged ledger balances during editing
- Posted-entry edit protection
- Reverse a posted journal entry into a new linked transaction awaiting approval
- Explicit approval and posting of reversing entries through the Accounting Core
- Original journal entries remain unchanged in the ledger
- Original transactions become `reversed` only after successful reversal posting
- Pending, completed, and stale duplicate-reversal protection by transaction ID
- Reversal-chain protection
- Ledger and Trial Balance include both original and reversing entries with zero net effect
- Session-only immutable transaction audit events for creation, review, editing, approval, posting, reversal creation/posting, and marking originals reversed
- Deterministic event IDs and injectable action timestamps with structured before/after edit snapshots
- Original transactions own specialized reversal audit events; reversing transactions keep their own creation, approval, and posting lifecycle, with related transaction IDs retained
- Successful operations append audit events through the Accounting Core; rejected actions leave history unchanged
- Collapsible per-transaction Audit trail displaying time, action, status transition, and related transaction

Editing, posting, reversal, and audit history remain in memory; transactions, reversal references, ledger state, and audit events are not persisted. Invalid, unbalanced, invalid-account, and mixed-currency edits are rejected without applying changes or successful audit events. Reversal creation leaves the original posted until the new transaction is approved and posted; posted and reversed originals remain non-editable. Audit logging does not change accounting amounts, journal lines, or balances.

Planned:

- Void / cancel where appropriate
- Transaction IDs
- Transaction dates
- Descriptions

Core workflow:

Natural Language\
→ Transaction Intent\
→ Suggested Journal Entry\
→ Review\
→ Edit and revalidate if needed\
→ Approval\
→ Posting\
→ Ledger\
→ Financial Statements

**Rule:** No transaction should be posted without explicit user approval.

## ✅ Phase 3 — Financial Statements

Completed. The General Ledger, Trial Balance, Profit & Loss, Balance Sheet, accounting-driven Dashboard, and account-level drill-down integrations are complete.

Completed:

- General Ledger at `/ledger` with a sidebar navigation item
- Posted journal lines from the existing Accounting Core, including originals and separately posted reversals
- Chart of Accounts filter and inclusive date-range filtering for the General Ledger
- Debit and credit totals and selected-account balances calculated through existing Accounting Core functions
- Clear period-balance labels, currency display, empty states, and safe handling of invalid ledger data
- Shared in-memory Chat and accounting session state across client navigation; transactions, audit history, reversal references, and the ID sequence reset on refresh
- Trial Balance at `/trial-balance` with a sidebar navigation item and the same shared session ledger
- Every Chart of Accounts row, including zero balances, with account code, name, type, debit balance, and credit balance
- Net account-balance totals, signed debit-minus-credit difference, and Balanced / Out of balance status supplied by the Accounting Core under its existing `1e-9` tolerance
- Optional inclusive As of date filter that includes all earlier posted journal dates and preserves core calculation order
- Explicit core-validated currency, helpful empty states, and safe rejection of invalid, mixed-currency, or nonfinite report data
- Profit & Loss at `/profit-loss` with a sidebar navigation item and the same shared session ledger
- Revenue, expenses, net profit or loss, and account code/name/classification/amount breakdown supplied by the existing Accounting Core `classifyProfitAndLoss` calculation
- Chart of Accounts classifications determine the revenue and expense rows; signed balances, including negative amounts and offsetting posted reversals, are preserved
- Inclusive start/end journal-date filters with either boundary optional, invalid-range validation, and all-posted reporting when both dates are blank
- Whole-source currency and accounting validation before period filtering, explicit currency labels, accessible controls, responsive layout, and empty states for periods without posted revenue or expense activity
- Balance Sheet at `/balance-sheet` with a sidebar navigation item and the same shared session ledger
- Separate Assets, Liabilities, and Equity sections classified by Chart of Accounts types, including zero and signed negative balances
- Pure Accounting Core `createBalanceSheetStatement` reuses the existing Balance Sheet classification and Profit & Loss calculation without changing existing statement snapshots or posting behavior
- Transparent Current earnings / Net income line from the same cumulative journals, an equity-account subtotal, and total equity including those earnings; no balancing plug or closing journal
- Total assets, total liabilities, total equity, liabilities plus equity, and the actual signed equation difference, with Balanced / Out of balance status under the existing inclusive `1e-9` tolerance
- Optional inclusive As of journal-date filter, complete-source currency and numeric validation, clear empty/error states, explicit currency, and accessible responsive controls and account tables
- Dashboard accounting KPIs from the same session ledger: Revenue, Expenses, and Net profit / loss reuse the Profit & Loss report; cumulative Cash and Bank balances reuse the Balance Sheet report when their canonical Chart of Accounts asset accounts are uniquely defined
- Dashboard uses all posted journals as its documented default period because it has no period selector; it preserves posted reversals as separate entries, reports the validated currency, and shows an empty state when no posted journals exist
- Dashboard labels uploaded spreadsheet analysis as a separate source; its charts, ratios, alerts, and insights continue to use analyzed upload rows and are not combined with accounting journals
- Dashboard integration tests cover posted/unposted entries, reversals, report agreement, signed balances, currency and source validation, empty state, session navigation updates, and read-only behavior
- Account-level drill-down links from Trial Balance, Profit & Loss, Balance Sheet account rows, and uniquely identified Dashboard Cash/Bank KPIs to the existing General Ledger account filter
- General Ledger validates its `accountId` query parameter against the Chart of Accounts, initializes the visible existing filter for valid IDs, and safely blocks ledger rows for invalid IDs until the user changes or clears the filter
- Drill-down carries inclusive Profit & Loss `startDate` / `endDate` filters and Trial Balance / Balance Sheet `asOfDate` as the General Ledger inclusive `endDate`; Dashboard links add no date filter
- Focused account drill-down tests cover link targets, date context, query validation, filter changes and clearing, Dashboard account uniqueness, and read-only navigation

The General Ledger does not persist accounting data. Date-filtered account balances represent movement within the selected period, excluding opening balances. Running balances are omitted because the Accounting Core does not expose balances after each individual journal line.

The Trial Balance is cumulative through the selected journal date, not a period-movement report. Missing or invalid posted journal dates prevent as-of reporting; the all-posted view remains available for valid accounting amounts. As-of reports use the current session's posted journals and their journal dates, not historical posting-time snapshots. Reversals use the original journal date unless edited before posting, so backdated postings and reversals can change an earlier as-of result. Accounting state remains in memory and clears on refresh.

Profit & Loss reports movement within the selected inclusive journal-date period. Only entries in the posted session ledger contribute; drafts, awaiting-approval transactions, approved-but-unposted transactions, and unposted reversals do not. Posted originals and posted reversals both contribute, and their amounts offset when both journal dates fall within the period. Missing or invalid journal dates prevent period filtering; the all-posted report includes their valid amounts with a warning. Filtering is read-only and preserves the Accounting Core's existing precision and summation order. A period with no included entries retains the validated session currency, while an empty session has no established currency. Backdated postings and reversals can change earlier period results; this is not a historical posting-time snapshot. There is no persistence, and refreshing clears the session.

The Balance Sheet is cumulative through the selected inclusive journal date, or includes all posted journals when the date is blank. Current earnings mean revenue minus expenses from the current session's posted journals through that same cutoff; there is no fiscal-year boundary or period-close operation. Total equity equals the classified equity-account balances plus the separately displayed current earnings. The report checks `assets - (liabilities + total equity)` against the existing absolute `1e-9` tolerance and retains the actual difference, including differences within tolerance. Account balances are never clamped or adjusted to force the equation to balance. Posted originals and posted reversals both contribute; pending reversals and other unposted transactions do not. Viewing and filtering preserve session transactions, workflow, audit events, and ledger snapshots. Missing or invalid journal dates block as-of reporting while valid all-posted amounts remain available with a warning. Currency validation applies to the complete posted source before filtering; an empty cutoff retains the validated session currency, and an empty session has no established currency. Backdated postings and reversals may change earlier as-of results, which are based on the current posted journals rather than historical posting-time snapshots. Refreshing clears the session; there is no persistence.

The Dashboard shares the root `AccountingSessionProvider` and the Chat state's posted ledger; it does not create another accounting store or mutate transactions. Its all-posted view includes entries with valid amounts even if their journal dates are missing or invalid, and displays a warning with their count. Since it has no date selector, Revenue, Expenses, and Net profit / loss use the same all-posted Profit & Loss report period, while Cash and Bank use cumulative as-of balances from the same all-posted Balance Sheet calculation. Mixed or invalid currencies and malformed posted data produce a safe error state. Cash or Bank is shown only when the corresponding canonical account ID maps uniquely to an asset account. The existing upload charts and analysis remain separate and explicitly identified as spreadsheet-derived. Session accounting data remains in memory and clears on refresh.

Account rows link to `/ledger?accountId=<account-id>` using stable Chart of Accounts IDs. Profit & Loss links retain their inclusive `startDate` and `endDate`; Trial Balance and Balance Sheet as-of dates become the inclusive General Ledger `endDate`; Dashboard Cash/Bank links contain no date boundary. The General Ledger validates URL account IDs against the Chart of Accounts and initializes its existing account control; invalid or repeated account parameters show a safe error without displaying an unfiltered ledger. Users can change or clear the filter through the existing controls.

## 🚧 Phase 4 — AI Accountant

In progress. The first task adds grounded AI-assisted interpretation for clear
English transaction paraphrases while retaining deterministic Accounting Core
validation and explicit approval.

Completed:

- Collapsible "Why this entry?" explanation on valid suggested journal entries awaiting approval
- Account debit / credit rationale derived from validated journal lines and Chart of Accounts classifications
- Optional local Ollama wording receives only account IDs, names, classifications, sides, and balance effects; it cannot change journal lines or amounts
- Strict response validation rejects changed or unsupported account references; deterministic classification-based explanations remain available when Ollama is unavailable or returns invalid output
- Explanation view is read-only, transient, and hidden for invalid entries, drafts, unresolved messages, and reversals
- Explanation behavior and trust boundaries documented in `docs/accounting-explanations.md`
- The deterministic transaction parser remains first; already-resolved transactions do not call Ollama
- Separate local Ollama transaction interpretation contract; the AI Analyst contract and validation remain unchanged
- Exact quoted evidence validation against the original description and restricted intent/category/account mappings
- Amounts and currencies are re-extracted and validated from the original input; the model cannot supply them
- Accepted paraphrases pass through the existing Transaction Intent, Suggested Journal Entry, and Accounting Core validation path
- Provider errors, timeouts, malformed output, missing facts, and conflicting evidence safely retain clarification behavior
- Suggestions remain awaiting explicit approval; the AI path does not approve, post, or persist accounting state
- Initial supported English paraphrases and trust boundaries documented in `docs/transaction-understanding.md`

Remaining planned work:

- Natural-language accounting interaction
- AI suggests next actions

## ⏳ Phase 5 — Documents

Planned:

- Invoices
- Receipts
- Bank statements
- PDF ingestion
- Excel / CSV document workflows
- Document extraction
- Validation
- Suggested journal entries from documents

## ⏳ Phase 6 — Accountant Workspace

Planned:

- Company workspace
- Chart of Accounts management
- Transactions
- Journal
- General Ledger
- Reports
- Documents
- AI Accountant
- Multi-company
- Users
- Permissions
- Persistent audit logs across sessions

## ⏳ Phase 7 — Professional Accounting Platform

Future scope:

- VAT / tax workflows
- Budgeting
- Cash flow
- Financial ratios
- Period close
- Bank reconciliation
- Bank integrations
- Payroll
- APIs
- External integrations
- XBRL
- Advanced reporting

## Product Principles

1. Deterministic accounting logic is the source of truth.
2. AI assists with language and interpretation, not financial authority.
3. Never guess missing accounting information.
4. Never post without explicit approval.
5. Keep accounting logic independent from UI and AI providers.
6. Complete the current phase before adding unrelated features.

**Current Status: Phase 3 complete — General Ledger, Trial Balance, Profit & Loss, Balance Sheet, accounting-driven Dashboard, and account-level drill-down are implemented and verified.**
