# Suggested Entry Explanations

LedgerAI shows a collapsed **Why this entry?** panel on a valid suggested journal entry while it awaits approval. The panel explains each debit and credit using the account's Chart of Accounts classification and its normal balance side. It is informational and does not change the suggestion or any accounting state.

The deterministic explanation is available immediately. When the panel is opened, LedgerAI may ask the configured local Ollama model to phrase the explanation. The model receives only the validated account ID, account name, account type, journal side, and resulting increase or decrease. It does not receive the journal description, date, currency, or amounts, and its response cannot change accounts, sides, or journal values.

Model output must match every validated journal line and reference the canonical account name, classification, side, and balance effect. Unsupported or malformed output is discarded. If Ollama is unavailable, times out, or returns invalid output, the deterministic explanation remains visible.

The panel is hidden for invalid entries, drafts, unresolved messages, and reversals. Viewing or opening it does not mutate transactions, workflow status, audit events, session state, or persistence.
