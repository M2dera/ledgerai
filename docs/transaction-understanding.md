# AI-assisted transaction understanding

The chat tries `parseTransactionIntent()` first. A transaction that resolves there
does not call Ollama. For an unresolved or unsupported transaction statement with
one valid, explicit amount and currency, chat can ask the configured local Ollama
model to classify a clear paraphrase. Existing financial questions continue to
use the separate AI Analyst request and response contract.

The transaction model contract returns only an intent type and exact quoted
evidence for the action, category, and (when required) bank or cash settlement
account. It has no fields for an amount, currency, Chart of Accounts ID, journal
line, approval, or posting. LedgerAI checks every quote against the original
description, checks the evidence against the supported English transaction and
category vocabulary, rejects conflicting action/category/account clues, and
recovers the amount and currency again from the original description using the
deterministic parser and existing currency detector.

Clear English paraphrases currently eligible for interpretation include:

- `Paid office rent of 600 KWD from the bank account.` → rent expense paid from Bank.
- `Settled our office rent using cash for 1,200 SAR` → rent expense paid from cash.
- `Received an unpaid utilities invoice for 80 USD` → utilities expense on account.
- `Collected payment for consulting services into bank, 500 SAR` → service revenue received into bank.
- `Provided services to a client on account for 500 SAR` → service revenue on account.
- `Acquired a laptop using bank for 900 USD` → computer equipment purchased from bank.
- `Owner contributed capital into the bank account for 2,000 SAR` → owner investment received into bank.

The selected accounts are mapped from LedgerAI's existing Chart of Accounts and
passed through `suggestJournalEntry()` and Accounting Core validation. On-account
transactions use the existing fixed receivable/payable mappings after their
explicit transaction type is validated. Every accepted result remains a
suggestion awaiting user approval; the AI path does not mutate accounting state.

Missing or ambiguous amount/currency is clarified before Ollama is called.
Missing categories or settlement accounts, unquoted/fabricated evidence,
contradictory classifications, malformed responses, provider errors, or timeouts
cannot create a suggestion. Ollama failures retain the deterministic parser's
clarification behavior. This first Phase 4 task does not add Arabic paraphrase
interpretation; the existing deterministic Arabic phrases continue to work.
