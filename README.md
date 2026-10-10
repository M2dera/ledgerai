# LedgerAI

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-4-38BDF8?logo=tailwindcss)
![Status](https://img.shields.io/badge/Status-Active_Development-brightgreen)

> Financial analysis and deterministic insights for business data

LedgerAI is an AI platform designed to help accountants, business owners, and finance teams analyze financial data faster and make smarter decisions.

## 💡 Why LedgerAI?

Traditional accounting software shows numbers.

**LedgerAI explains them.**

Instead of manually searching through spreadsheets, LedgerAI analyzes supported financial rows, detects key metrics, and explains deterministic observations. AI-generated analysis is future functionality.
## 📸 Dashboard Preview

![LedgerAI Dashboard](./public/dashboard.png)
---

## ✨ Features

- 📄 Excel Upload
- 📊 Financial Dashboard
- 💰 Revenue, Expenses & Profit Detection
- Deterministic Financial Insights
- 📈 Smart Analytics
- 📑 Financial Reports
- Edit unposted journal entries with validation, then explicitly approve and post to the session ledger

In chat, **Edit** lets you review the date, description, currency, accounts, and debit/credit lines before posting. **Save** applies only a valid, balanced entry and preserves its transaction ID. Editing an approved entry returns it to **Awaiting approval**; posted entries cannot be edited. Editing never changes ledger balances. Journal entries and the ledger remain in memory only. See [the journal workflow documentation](docs/suggested-journal-entry.md) for details.

---

## 🛠 Tech Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- XLSX

---

## 🚀 Roadmap

### ✅ Sprint 1
- Project setup
- GitHub
- Excel Reader

### ✅ Sprint 2
- Dashboard
- Sidebar
- KPI Cards

### 🚧 Sprint 3
- Smart Financial Engine
- AI Insights

### ⏳ Coming Soon

- Charts
- Dataset Question and Answering (deterministic; no AI service connected)
- PDF Reports
- Multi-company Support
- Authentication
- Team Collaboration

---

## 🎯 Vision

Build the smartest AI platform for accountants.

---

## 📌 Status

Currently under active development.

## Identity and company-context foundation

The invite-only identity and company-context foundation uses Auth.js with a configurable OIDC provider, database-backed sessions, PostgreSQL, and Drizzle migrations. These foundations protect the current AI/data POST APIs and provide server-side company-role checks for future server commands.

**Accounting journal entries, approvals, posting, edits, reversals, audit history, reports, and Q&A remain session-only.** The existing client-side accounting mutations are not protected by server-enforced company authorization. Sign-in does not make the accounting ledger durable, company-isolated, or safe for real external financial data. LedgerAI is not production-ready and is not ready for an external financial-data pilot.

### Local database and identity setup

Docker Desktop is the only local database prerequisite. The Compose service binds PostgreSQL to `127.0.0.1` and uses a known development-only password; do not reuse it outside a local machine.

1. Copy `.env.example` to `.env.local` and set a unique `AUTH_SECRET`, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Keep `.env.local` out of version control.
2. Configure `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` with a trusted OIDC issuer. Register `http://localhost:3000/api/auth/callback/oidc` as the development callback URL. The issuer must return a verified `email_verified: true` claim.
3. Start PostgreSQL and apply the checked-in SQL migration:

   ```powershell
   docker compose up -d postgres
   npm.cmd run db:migrate
   npm.cmd run dev
   ```

   `DATABASE_URL` defaults in `.env.example` to the local-only Compose database. Migration commands fail clearly if it is absent or the database cannot be reached. Generate a future versioned migration with `npm.cmd run db:generate`; review and commit the resulting SQL migration and snapshot together.

4. Create the first company and an owner invitation from the local database. Replace the example name and email. Invitations are lower-cased, expire after seven days, and can be revoked by setting `revoked_at`.

   ```powershell
   docker compose exec postgres psql -U ledgerai -d ledgerai
   ```

   Then run:

   ```sql
   WITH new_company AS (
     INSERT INTO companies (name) VALUES ('Example Company') RETURNING id
   )
   INSERT INTO company_invitations (company_id, email, role, expires_at)
   SELECT id, lower('owner@example.com'), 'owner', now() + interval '7 days'
   FROM new_company;
   ```

   Invite additional users by inserting another `company_invitations` row with the company ID, lower-cased email, one of `owner`, `accountant`, `approver`, or `viewer`, and an expiry. There is no public enrollment or invite-management endpoint in this task.

The reusable permission helper defines owner access to all permissions, accountant access to read/prepare/post, approver access to read/approve, and viewer access to read. All four roles can use the current AI APIs. Only the AI permission is currently enforced by routes; accounting permissions are groundwork for Task 2 and do not secure the existing browser workflow.

The server stores only the database session and OIDC account identity needed for sign-in; unused access, refresh, and ID tokens are stripped before account persistence. If identity or database configuration is incomplete, protected APIs return an error instead of granting anonymous access. `AUTH_TRUST_HOST=true` is for local development only; configure trusted host handling according to the deployment environment before any hosted use.

The pilot's separation-of-duties policy is that a person should not approve their own journal entry. This is not enforced by the current client-side workflow. It must be checked against authenticated actors in the server-side accounting command service in Task 2.

The normal automated suite uses mocked identity behavior and static migration checks. To run the optional PostgreSQL migration integration test, set `TEST_DATABASE_URL` to a dedicated disposable local database and run `npm.cmd test`; the integration test applies migrations and checks the resulting tables and constraints. Do not point it at a database containing data you need to preserve.
