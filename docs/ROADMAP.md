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

## 🚧 Phase 3 — Financial Statements

In progress. The General Ledger, Trial Balance, and Profit & Loss UIs are complete; Balance Sheet and the accounting-driven Dashboard remain planned.

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

Planned:

- Balance Sheet UI
- Accounting-driven Dashboard
- Period filtering for the remaining financial statement interfaces
- Account-level drill-down beyond the General Ledger account filter

The General Ledger does not persist accounting data. Date-filtered account balances represent movement within the selected period, excluding opening balances. Running balances are omitted because the Accounting Core does not expose balances after each individual journal line.

The Trial Balance is cumulative through the selected journal date, not a period-movement report. Missing or invalid posted journal dates prevent as-of reporting; the all-posted view remains available for valid accounting amounts. As-of reports use the current session's posted journals and their journal dates, not historical posting-time snapshots. Reversals use the original journal date unless edited before posting, so backdated postings and reversals can change an earlier as-of result. Accounting state remains in memory and clears on refresh.

Profit & Loss reports movement within the selected inclusive journal-date period. Only entries in the posted session ledger contribute; drafts, awaiting-approval transactions, approved-but-unposted transactions, and unposted reversals do not. Posted originals and posted reversals both contribute, and their amounts offset when both journal dates fall within the period. Missing or invalid journal dates prevent period filtering; the all-posted report includes their valid amounts with a warning. Filtering is read-only and preserves the Accounting Core's existing precision and summation order. A period with no included entries retains the validated session currency, while an empty session has no established currency. Backdated postings and reversals can change earlier period results; this is not a historical posting-time snapshot. There is no persistence, and refreshing clears the session.

## ⏳ Phase 4 — AI Accountant

Planned:

- Natural-language accounting interaction
- AI-assisted transaction understanding
- AI explains accounting treatment
- AI suggests next actions
- Deterministic accounting engine remains authoritative
- AI cannot directly post transactions
- User approval required before posting

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

**Current Status: Phase 3 in progress — General Ledger, Trial Balance, and Profit & Loss UIs complete; Balance Sheet and accounting-driven Dashboard interfaces remain planned.**
