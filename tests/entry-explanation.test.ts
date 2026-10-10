import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntryExplanation from "@/components/chat/EntryExplanation";
import { POST } from "@/app/api/entry-explanation/route";
import {
  createDeterministicEntryExplanation,
  createEntryExplanation,
  createEntryExplanationFacts,
  resolveEntryExplanation,
} from "@/lib/accounting/entry-explanation";
import { createOllamaEntryExplanationInterpreter } from "@/lib/ai/providers/ollama-entry-explanation";
import type { JournalEntry } from "@/lib/accounting/types";

const sampleEntry: JournalEntry = {
  id: "suggestion-1",
  date: "2026-10-08",
  description: "Paid office rent of 600 KWD from the bank account.",
  currency: "KWD",
  lines: [
    { accountId: "rent-expense", debit: 600, credit: 0 },
    { accountId: "bank", debit: 0, credit: 600 },
  ],
};

const validModelAnswer = {
  lines: [
    { accountId: "rent-expense", side: "debit", explanation: "Rent Expense is debited because it is an expense account and debits increase its balance." },
    { accountId: "bank", side: "credit", explanation: "Bank is credited because it is an asset account and credits decrease its balance." },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("suggested entry explanation", () => {
  it("derives debit and credit rationales from the Chart of Accounts", () => {
    const facts = createEntryExplanationFacts(sampleEntry);
    expect(facts).toEqual([
      { accountId: "rent-expense", accountName: "Rent Expense", accountType: "expense", side: "debit", balanceEffect: "increases" },
      { accountId: "bank", accountName: "Bank", accountType: "asset", side: "credit", balanceEffect: "decreases" },
    ]);
    expect(createDeterministicEntryExplanation(facts!).lines.map(({ explanation }) => explanation)).toEqual([
      "Rent Expense is debited because it is classified as an expense account; a debit increases its balance.",
      "Bank is credited because it is classified as an asset account; a credit decreases its balance.",
    ]);
  });

  it("accepts a validated explanation and rejects fabricated accounts or changed lines", () => {
    const facts = createEntryExplanationFacts(sampleEntry)!;
    expect(createEntryExplanation(validModelAnswer, facts)?.source).toBe("ollama");
    expect(createEntryExplanation({
      lines: validModelAnswer.lines.map((line) => ({ ...line, explanation: line.explanation.replace("Bank", "New Clearing Account") })),
    }, facts)).toBeUndefined();
    expect(createEntryExplanation({
      lines: validModelAnswer.lines.map((line, index) => index === 0
        ? { ...line, explanation: "Rent Expense is debited because it is not an expense account and debits decrease its balance." }
        : line),
    }, facts)).toBeUndefined();
    expect(createEntryExplanation({ lines: validModelAnswer.lines.map((line) => ({ ...line, accountId: "invented-account" })) }, facts)).toBeUndefined();
  });

  it("uses deterministic fallback for malformed model output and provider errors", async () => {
    const facts = createEntryExplanationFacts(sampleEntry)!;
    await expect(resolveEntryExplanation(facts, async () => ({ lines: [] }))).resolves.toMatchObject({ source: "deterministic" });
    await expect(resolveEntryExplanation(facts, async () => { throw new Error("Ollama is unavailable"); })).resolves.toMatchObject({ source: "deterministic" });
  });

  it("keeps immutable entry facts and does not mutate the suggested entry", async () => {
    const entry = Object.freeze({
      ...sampleEntry,
      lines: Object.freeze(sampleEntry.lines.map((line) => Object.freeze({ ...line }))),
    }) as JournalEntry;
    const before = JSON.stringify(entry);
    const facts = createEntryExplanationFacts(entry)!;
    await resolveEntryExplanation(facts, async (receivedFacts) => {
      expect(Object.isFrozen(receivedFacts)).toBe(true);
      expect(Object.isFrozen(receivedFacts[0])).toBe(true);
      return validModelAnswer;
    });
    expect(JSON.stringify(entry)).toBe(before);
  });

  it("does not render for an invalid journal entry", () => {
    const invalid = { ...sampleEntry, lines: [{ accountId: "rent-expense", debit: 600, credit: 0 }] } as JournalEntry;
    expect(renderToStaticMarkup(createElement(EntryExplanation, { entry: invalid }))).toBe("");
  });

  it("renders an accessible collapsed explanation for a valid entry", () => {
    const html = renderToStaticMarkup(createElement(EntryExplanation, { entry: sampleEntry }));
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Why this entry?");
    expect(html).toContain("Rent Expense");
    expect(html).toContain("Bank");
    expect(html).toContain("Informational explanation");
  });

  it("sends only typed accounting facts to Ollama and returns the validated explanation", async () => {
    let requestBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return Response.json({ message: { content: JSON.stringify(validModelAnswer) }, done_reason: "stop" });
    }));
    const request = new Request("http://localhost/api/entry-explanation", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: sampleEntry }),
    });
    const response = await POST(request);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.explanation.source).toBe("ollama");
    const modelRequest = JSON.parse(requestBody) as { messages: Array<{ role: string; content: string }> };
    const modelFacts = JSON.parse(modelRequest.messages[1].content) as { facts: Array<Record<string, unknown>> };
    expect(modelFacts.facts[0]).toMatchObject({ accountType: "expense", side: "debit", balanceEffect: "increases" });
    expect(modelFacts.facts[1]).toMatchObject({ accountType: "asset", side: "credit", balanceEffect: "decreases" });
    expect(requestBody).not.toContain("600");
    expect(requestBody).not.toContain("KWD");
    expect(requestBody).not.toContain("2026-10-08");
    expect(requestBody).not.toContain(sampleEntry.description);
  });

  it("rejects invalid requests and safely falls back when Ollama returns malformed output", async () => {
    const invalid = { ...sampleEntry, lines: [{ accountId: "fake", debit: 600, credit: 0 }] };
    const invalidResponse = await POST(new Request("http://localhost/api/entry-explanation", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: invalid }),
    }));
    expect(invalidResponse.status).toBe(400);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: { content: "not JSON" }, done_reason: "stop" })));
    const response = await POST(new Request("http://localhost/api/entry-explanation", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: sampleEntry }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ explanation: { source: "deterministic" } });
  });

  it("provider reports malformed Ollama responses for deterministic fallback", async () => {
    const interpreter = createOllamaEntryExplanationInterpreter({
      fetcher: vi.fn(async () => Response.json({ message: { content: "not JSON" }, done_reason: "stop" })),
    });
    const facts = createEntryExplanationFacts(sampleEntry)!;
    const resolved = await resolveEntryExplanation(facts, interpreter);
    expect(resolved.source).toBe("deterministic");
  });
});
