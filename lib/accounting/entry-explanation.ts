import { DEFAULT_CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import type { Account, AccountType, JournalEntry, JournalEntryLine } from "./types";
import { validateJournalEntry } from "./validation";

export type EntryExplanationFact = {
  accountId: string;
  accountName: string;
  accountType: AccountType;
  side: "debit" | "credit";
  balanceEffect: "increases" | "decreases";
};

export type EntryExplanationLine = Pick<EntryExplanationFact, "accountId" | "side"> & { explanation: string };
export type EntryExplanation = { lines: EntryExplanationLine[]; source: "ollama" | "deterministic" };
export type EntryExplanationInterpreter = (facts: readonly EntryExplanationFact[], signal?: AbortSignal) => Promise<unknown>;

function sideOf(line: JournalEntryLine): "debit" | "credit" | undefined {
  if (line.debit > 0 && line.credit === 0) return "debit";
  if (line.credit > 0 && line.debit === 0) return "credit";
  return undefined;
}

function effectOf(type: AccountType, side: "debit" | "credit"): "increases" | "decreases" {
  const normalSide = type === "asset" || type === "expense" ? "debit" : "credit";
  return side === normalSide ? "increases" : "decreases";
}

/** Builds explanation facts only from a balanced, chart-valid journal entry. */
export function createEntryExplanationFacts(
  entry: JournalEntry,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): readonly EntryExplanationFact[] | undefined {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.lines) || !validateJournalEntry(entry, accounts).valid) return undefined;
  const facts: EntryExplanationFact[] = [];
  for (const line of entry.lines) {
    const matches = accounts.filter((account) => account.id === line.accountId);
    const side = sideOf(line);
    if (matches.length !== 1 || !side) return undefined;
    const account = matches[0];
    facts.push(Object.freeze({ accountId: account.id, accountName: account.name, accountType: account.type, side, balanceEffect: effectOf(account.type, side) }));
  }
  return Object.freeze(facts);
}

function deterministicLine(fact: EntryExplanationFact): EntryExplanationLine {
  const verb = fact.side === "debit" ? "debited" : "credited";
  const article = ["asset", "expense", "equity"].includes(fact.accountType) ? "an" : "a";
  const side = fact.side === "debit" ? "debit" : "credit";
  return {
    accountId: fact.accountId,
    side: fact.side,
    explanation: `${fact.accountName} is ${verb} because it is classified as ${article} ${fact.accountType} account; a ${side} ${fact.balanceEffect} its balance.`,
  };
}

export function createDeterministicEntryExplanation(facts: readonly EntryExplanationFact[]): EntryExplanation {
  return { source: "deterministic", lines: facts.map(deterministicLine) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** Rejects changed line references, amounts, unsupported account names, and ungrounded rationales. */
export function validateEntryExplanation(
  value: unknown,
  facts: readonly EntryExplanationFact[],
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): value is { lines: EntryExplanationLine[] } {
  if (!isRecord(value) || Object.keys(value).join(",") !== "lines" || !Array.isArray(value.lines) || value.lines.length !== facts.length) return false;
  const validIds = new Set(facts.map((fact) => fact.accountId));
  return value.lines.every((lineValue, index) => {
    const fact = facts[index];
    if (!isRecord(lineValue) || Object.keys(lineValue).sort().join(",") !== "accountId,explanation,side" ||
        lineValue.accountId !== fact.accountId || lineValue.side !== fact.side || typeof lineValue.explanation !== "string") return false;
    const explanation = lineValue.explanation.trim();
    if (!explanation || explanation.length > 220 || /[\d%$\u20AC\u00A3\u00A5]/u.test(explanation)) return false;
    const text = normalized(explanation);
    const sideWord = fact.side === "debit" ? /\bdebit(?:ed|s)?\b/i : /\bcredit(?:ed|s)?\b/i;
    const oppositeSideWord = fact.side === "debit" ? /\bcredit(?:ed|s)?\b/i : /\bdebit(?:ed|s)?\b/i;
    const effectWord = fact.balanceEffect === "increases" ? /\bincreases?\b/i : /\bdecreases?\b/i;
    const oppositeEffectWord = fact.balanceEffect === "increases" ? /\bdecreases?\b/i : /\bincreases?\b/i;
    if (/\b(?:not|never|no|cannot|can't|doesn't|isn't)\b/i.test(text) ||
        !text.includes(normalized(fact.accountName)) || !sideWord.test(text) || oppositeSideWord.test(text) || oppositeEffectWord.test(text) ||
        !new RegExp(`\\b${fact.accountType}\\b`, "i").test(text) || !effectWord.test(text)) return false;
    if (accounts.some((account) => account.type !== fact.accountType &&
        new RegExp(`\\b${account.type}\\b`, "i").test(text))) return false;
    return accounts.every((account) => validIds.has(account.id) || !text.includes(normalized(account.name)));
  });
}

export function createEntryExplanation(
  value: unknown,
  facts: readonly EntryExplanationFact[],
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): EntryExplanation | undefined {
  if (!validateEntryExplanation(value, facts, accounts)) return undefined;
  return { source: "ollama", lines: value.lines as EntryExplanationLine[] };
}

/** Uses Ollama only for optional wording; all accounting facts remain deterministic. */
export async function resolveEntryExplanation(
  facts: readonly EntryExplanationFact[],
  interpreter: EntryExplanationInterpreter,
  accounts: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
  signal?: AbortSignal,
): Promise<EntryExplanation> {
  try {
    const explanation = createEntryExplanation(await interpreter(facts, signal), facts, accounts);
    if (explanation) return explanation;
  } catch {
    // Provider failures are presentation-only and use the deterministic explanation below.
  }
  return createDeterministicEntryExplanation(facts);
}
