# Transaction Intent Engine v1

`parseTransactionIntent(description)` is a pure TypeScript function exported from
`lib/accounting`. It recognizes the complete clauses below, returning normalized
evidence and structured issues. It does not create journal entries, post balances,
persist data, call models, or change the AI Analyst.

## Result contract

- `resolved`: the supported clause establishes the amount, currency, primary
  account hint, and any required payment account. `issues` is empty. This is an
  intent, not approval to post an entry.
- `unresolved`: supported evidence is retained, but information is missing,
  conflicting, or invalid. Unknown fields are omitted; `issues` explains why.
- `unsupported`: invalid input or text outside the explicit grammar. No account
  hints are extracted from unmatched clauses. Independently validated monetary
  facts may be retained; they must not be used to post an entry.

`TransactionIntent` contains `intentType`, `amount`, `currency`, and the original
`description`. Optional evidence includes `categoryHint`, `accountHint`,
`sourceAccountHint`, `destinationAccountHint`, and `counterparty`. Incomplete
results use `PartialTransactionIntent`. Account hints use the existing
`Account` ID and type; currency uses `JournalEntry["currency"]` and the existing
financial unit detector. There is no probabilistic confidence score.

## Exact clause grammar

The table uses `MONEY` for one numeric amount with an optional explicit currency
marker, either `amount currency` or `currency amount`. A missing currency produces
`MISSING_CURRENCY`. Brackets indicate optional text, and `|` lists alternatives.
Words in the statement must be separated by whitespace, except the Arabic price
prefix `ب` may be attached to the number (`ب2000`).

```text
expense_payment
  AR: (دفعت|دفعنا) [EXPENSE] MONEY [من ACCOUNT] [(للمورد|لمورد) ["name"]]
  EN: (paid|we paid) [EXPENSE] MONEY [from [the] ACCOUNT] [to [the|a] supplier ["name"]]

expense_on_account
  AR: (استلمت|استلمنا) (فاتورة|فاتوره) [EXPENSE] MONEY [من (المورد|مورد) ["name"]] UNPAID
  EN: (received|we received) [a|an] [EXPENSE] invoice [for] MONEY [from [the|a] supplier ["name"]] [and] (unpaid|not paid|on account)

revenue_receipt
  AR: (استلمت|استلمنا) من (العميل|عميل) ["name"] MONEY [مقابل SERVICE] [(في|الى) ACCOUNT]
  EN: (received|we received) MONEY from [the|a] customer ["name"] [for SERVICE] [(into|to) [the] ACCOUNT]

revenue_on_account
  AR: (بعت|بعنا) (للعميل|لعميل) ["name"] [SERVICE] [ب|بـ|بمبلغ] MONEY UNRECEIVED
  EN: (sold|we sold) [a] [SERVICE] to [the|a] customer ["name"] [for] MONEY [and] (unpaid|not received|on account)

asset_purchase
  AR: (شريت|اشتريت) [ASSET] [ب|بـ|بمبلغ] MONEY [من ACCOUNT] [من (المورد|مورد) ["name"]]
  EN: (bought|we bought|purchased) [a] [ASSET] [for] MONEY [from [the] ACCOUNT] [from [the|a] supplier ["name"]]

owner_investment
  AR: (ضخت|ضخيت|استثمرت) MONEY في (الشركة|الشركه|شركة|شركه) [(في|الى) ACCOUNT]
  EN: (invested|we invested|injected) MONEY into [the] company [(into|to) [the] ACCOUNT]
```

Additional receipt orders: the service purpose can follow the destination in
Arabic and English. English also accepts
`received|we received from [the|a] customer ["name"] MONEY [for SERVICE] [into|to [the] ACCOUNT]`.
Other phrase orders and unlisted verbs are unsupported.

Arabic `UNPAID` is exactly `وما دفعتها`, `وما دفعناها`, `ولم ادفعها`, or
`على الحساب`. Arabic `UNRECEIVED` is exactly `وما استلمت المبلغ`,
`وما استلمنا المبلغ`, `ولم استلم المبلغ`, or `على الحساب`.

## Category and account vocabulary

Arabic words accept the definite article `ال` and the spelling normalization
below. Category words only map within their matching transaction clause.

| Category hint | Arabic vocabulary | English vocabulary | Existing primary account ID |
| --- | --- | --- | --- |
| `rent` | `إيجار`, `ايجار` | `rent` | `rent-expense` |
| `salaries` | `راتب`, `رواتب`, `أجور`, `اجور` | `salary`, `salaries`, `payroll`, `wage`, `wages` | `salaries-expense` |
| `utilities` | `كهرباء`, `ماي`, `ماء`, `مياه`, `خدمات` in an expense clause | `electricity`, `water`, `utility`, `utilities` | `utilities-expense` |
| `services` | `خدمة`, `خدمه`, `خدمات` in a revenue clause | `service`, `services` | `revenue` |
| `laptop` | `لابتوب` | `laptop` | None; `ASSET_ACCOUNT_REQUIRED` |
| `computer` | `حاسوب` | `computer` | None; `ASSET_ACCOUNT_REQUIRED` |

`ACCOUNT` is `bank` or `cash` in English; Arabic supports `بنك`, `البنك`,
`كاش`, `الكاش`, `صندوق`, `الصندوق`. These map to the existing `bank` and
`cash` IDs. Outgoing accounts require `from` / `من`; incoming accounts require
`into` / `to` / `في` / `الى`. A counterparty is not a payment account. Names are
optional, explicitly double-quoted, nonempty, and at most 80 characters. Their
original case and spelling are preserved; surrounding whitespace is trimmed.
Unquoted names and more than one quoted name are unsupported.
Absent names and absent counterparty roles are never supplied.

An owner investment has an `owners-equity` primary hint, but a company mention
alone does not establish its receiving account. On-account invoices and service
sales require the explicit unpaid/unreceived tail. Their type records the accrual
direction without inventing a bank/cash payment or party name.

## Monetary and safety rules

- One positive numeric amount, using ungrouped digits or comma-separated groups
  of three digits, and up to three decimal places. Numbers must be finite, no
  greater than `Number.MAX_SAFE_INTEGER`, and preserve the written decimal value
  when represented as a JavaScript number. Signs, zero, ranges, scientific notation,
  malformed grouping, multiple numbers, and excessive precision do not resolve.
- Currency markers: `KWD`, `KD`, `د.ك`, `د ك`, `دك`, `دينار كويتي`; `SAR`,
  `ر.س`, `ر س`, `ريال سعودي`; `AED`, `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `JPY`;
  and the unambiguous symbols `€`, `£`. Arabic initial abbreviations also permit a final period.
  ISO markers are case insensitive. Currency is preserved without conversion.
  Bare `$` and `¥` are ambiguous; bare `دينار` and unlisted markers establish no
  currency. Multiple currency markers remain ambiguous even if they repeat.
- Text normalizes Unicode NFKC, case, whitespace, Arabic diacritics/tatweel,
  `أ/إ/آ` to `ا`, Arabic/Persian digits, and Arabic numeric separators. Original
  description and explicitly quoted names remain intact. Trailing periods and
  exclamation marks are allowed. Questions (`?` or `؟`) are unsupported.
- Expense payments need a supported category and an explicit source account.
  Missing category gives `MISSING_CATEGORY`; missing source gives
  `MISSING_SOURCE_ACCOUNT`. No rent or bank hint is inserted as a default.
- Customer receipts need an explicit service purpose to establish a revenue
  hint. Otherwise `REVENUE_CONTEXT_REQUIRED` preserves the receipt classification
  without deciding between revenue, receivable settlement, or advance. Service
  sales without the service category receive the same issue. Receipts and owner
  investments need an explicit receiving account (`MISSING_DESTINATION_ACCOUNT`).
- Asset purchases retain their stated category and payment evidence but always
  remain unresolved: the existing chart has no fixed-asset account. No equipment
  account ID or name is fabricated and the chart is not extended by this engine.
- Conflicting supported account/category phrases joined with `or`, `and`, `او`,
  or `و` receive ambiguity issues and omit account/category hints. Other conflicting
  or compound clauses are rejected by the whole-clause grammar. Unsupported
  qualifiers, negation, future/conditional statements, advances, existing invoice
  collections, refunds, loans, and transfers never resolve.
- Runtime input must be a nonempty string of at most 1,000 characters. Internal
  `@` markers, including Unicode equivalents, are rejected. Malformed input is
  returned as structured issues; it is never coerced into a transaction.

## Examples

| Input | Result |
| --- | --- |
| `دفعت إيجار 600 د.ك من البنك` | Resolved: `expense_payment`, amount `600`, `KWD`, `rent`, primary `rent-expense`, source `bank`. |
| `استلمت فاتورة كهرباء 120 د.ك وما دفعتها` | Resolved: `expense_on_account`, amount `120`, `KWD`, `utilities`, primary `utilities-expense`; no payment account. |
| `received 2,000 USD from customer for services into bank` | Resolved: `revenue_receipt`, amount `2000`, `USD`, primary `revenue`, destination `bank`, customer role. |
| `بعت للعميل خدمة بـ 2,000 د.ك وما استلمت المبلغ` | Resolved: `revenue_on_account`, amount `2000`, `KWD`, primary `revenue`, customer role; no payment account. |
| `invested 5,000 KWD into company into bank` | Resolved: `owner_investment`, amount `5000`, `KWD`, primary `owners-equity`, destination `bank`. |
| `دفعت 600 د.ك` | Unresolved: category and source missing. |
| `دفعت إيجار 600 د.ك` | Unresolved: source missing; retain the rent hint. |
| `استلمت من العميل 2,000 د.ك` | Unresolved: revenue context and receiving account missing. |
| `اشتريت لابتوب بـ 300 د.ك من البنك` | Unresolved: retain laptop and bank evidence; fixed-asset account missing. |
| `ضخيت 5,000 د.ك في الشركة` | Unresolved: receiving account missing. |
| `paid rent 600 KWD from bank or cash` | Unresolved: conflicting account hints, neither selected. |

Focused coverage is in `tests/transaction-intent.test.ts`. This module has no
dependency on React, Next.js, storage, browser APIs, or model providers.
