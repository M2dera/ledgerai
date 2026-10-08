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
- No posting / no persistence yet

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

Next phase. Do not implement yet.

Planned:

- Draft transaction state
- Suggested transaction state
- Review workflow
- Approve transaction
- Post journal entry
- Posted state
- Edit before posting
- Reverse posted transaction
- Void / cancel where appropriate
- Transaction IDs
- Transaction dates
- Descriptions
- Audit trail
- Posted ledger updates
- Trial Balance updates after posting
- Financial statement updates after posting

Core workflow:

Natural Language\
→ Transaction Intent\
→ Suggested Journal Entry\
→ Review\
→ Approval\
→ Posting\
→ Ledger\
→ Financial Statements

**Rule:** No transaction should be posted without explicit user approval.

## ⏳ Phase 3 — Financial Statements

Planned:

- General Ledger UI
- Trial Balance UI
- Profit & Loss UI
- Balance Sheet UI
- Accounting-driven Dashboard
- Period filtering
- Account-level drill-down

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
- Audit logs

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

**Current Status: Phase 1 complete — ready to begin Phase 2.**
