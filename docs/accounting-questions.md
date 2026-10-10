# Natural-Language Accounting Questions

Chat supports a small deterministic set of questions over the current session's **posted accounting entries**. These answers are calculated locally through LedgerAI's existing Accounting Core reports. Ollama does not calculate or supply amounts.

## Supported questions

- Posted revenue, expenses, and net profit or loss.
- The normal-side balance of one Chart of Accounts account, including Bank and Cash.
- The largest expense account with a positive net expense balance.
- Total assets, liabilities, and equity from the Balance Sheet. Total equity includes the report's current earnings.
- Whether the Trial Balance is balanced.

Examples include:

- `How much revenue from posted entries?`
- `What are expenses from the posted ledger?`
- `What is net profit or loss from posted accounting transactions?`
- `What is the bank balance?`
- `What is the largest expense in the posted ledger?`
- `What are total assets from the Balance Sheet?`
- `Is the trial balance balanced?`
- `كم الإيرادات من القيود المرحلة؟`
- `شنو أكثر المصاريف في دفتر الأستاذ؟`
- `كم صافي الربح حسب القيود المحاسبية؟`
- `كم رصيد البنك؟`

Arabic and English patterns are recognized for these supported question types. Responses identify the source as `Posted accounting entries in this session`.

## Distinguishing data sources

Questions that say `posted`, `ledger`, `accounting entries`, `accounting transactions`, or refer to the Trial Balance or Balance Sheet use the current session's posted accounting entries. Questions asking for an account balance also use this source, even without a ledger phrase.

Generic financial questions such as `What is revenue?` continue to use the uploaded spreadsheet analysis when one is available. Ledger figures and spreadsheet figures are never combined. If the requested source is empty or invalid, Chat reports that condition instead of switching to the other source.

Draft, awaiting-approval, and approved-but-not-posted transactions are not in the posted ledger and do not contribute. Posted reversals are separate posted journal entries and offset the original according to the existing Accounting Core calculations.

## Date cutoffs and validation

One explicit cutoff is supported with `as of`, `through`, `up to`, `until`, `as at`, or the Arabic `حتى تاريخ`, followed by a date in `YYYY-MM-DD` format. The date is inclusive and is matched against journal dates, not posting timestamps. Profit & Loss questions include posted movement from the beginning of the available session through the cutoff. Account balances, Balance Sheet totals, and Trial Balance status are cumulative through the cutoff.

Invalid dates, multiple cutoffs, or a cutoff with missing or invalid journal dates produce a safe clarification or report error. Without a cutoff, reports use all posted entries. Mixed currencies, invalid currencies, and malformed journal data are rejected by the existing report or Core validation.

If an account name matches multiple accounts, Chat asks the user to name one account or give its Chart of Accounts code. Unsupported ledger questions receive a list of currently supported question types.

## Read-only behavior

Accounting questions read only the shared session ledger's posted journal entries. They do not change transactions, ledger balances, workflow status, audit history, persistence, or the transaction ID sequence. Asking a question may add the normal user and assistant chat messages to the current session.
