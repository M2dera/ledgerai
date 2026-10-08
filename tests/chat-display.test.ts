import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatPage from "@/app/chat/page";
import ChatWindow from "@/components/chat/ChatWindow";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import { routeChatMessage } from "@/lib/chat";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));
vi.mock("@/components/providers/LedgerProvider", () => ({ useLedgerData: vi.fn() }));

const metadata = { id: "display-suggestion", date: "2026-10-08" };

afterEach(() => vi.restoreAllMocks());

describe("accounting suggestions in chat", () => {
  it("displays the original transaction, accounting lines, and awaiting approval status", async () => {
    const transaction = "دفعت إيجار 600 د.ك من البنك";
    const result = await routeChatMessage(transaction, null, vi.fn(), metadata);
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected a suggestion.");
    const html = renderToStaticMarkup(createElement(ChatWindow, {
      messages: [{ sender: "ai", text: result.text, suggestion: result.suggestion }],
    }));

    expect(html).toContain("Transaction");
    expect(html).toContain(transaction);
    expect(html).toContain("Suggested Journal Entry");
    expect(html).toContain("Debit Rent Expense: 600 KWD");
    expect(html).toContain("Credit Bank: 600 KWD");
    expect(html).toContain("Awaiting approval");
    expect(html).not.toContain("<button");
  });

  it("preserves all three accounting decimal places and the explicit currency", async () => {
    const result = await routeChatMessage("paid rent 600.125 USD from cash", null, vi.fn(), metadata);
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected a suggestion.");
    const html = renderToStaticMarkup(createElement(ChatWindow, {
      messages: [{ sender: "ai", text: result.text, suggestion: result.suggestion }],
    }));

    expect(html).toContain("Debit Rent Expense: 600.125 USD");
    expect(html).toContain("Credit Cash: 600.125 USD");
  });

  it("shows missing-source clarification without an entry or approval status", async () => {
    const result = await routeChatMessage("دفعت إيجار 600 د.ك", null, vi.fn(), metadata);
    if (result.route !== "transaction" || result.status !== "unresolved") throw new Error("Expected clarification.");
    const html = renderToStaticMarkup(createElement(ChatWindow, {
      messages: [{ sender: "ai", text: result.text }],
    }));

    expect(html).toContain("من أي حساب تم الدفع: البنك أم الصندوق؟");
    expect(html).toContain('dir="auto"');
    expect(html).not.toContain("Suggested Journal Entry");
    expect(html).not.toContain("Awaiting approval");
  });

  it("keeps chat input available for transactions without a financial dataset", () => {
    vi.mocked(useLedgerData).mockReturnValue({
      dataset: null, isReady: true, insights: [], alerts: [],
      uploadFeedback: { status: "idle", message: "", warnings: [], errors: [] },
      uploadFile: vi.fn(),
    });
    const html = renderToStaticMarkup(createElement(ChatPage));

    expect(html).toContain("Upload a dataset for financial analysis");
    expect(html).toContain("LedgerAI Assistant");
    expect(html).toContain("Ask a financial question or describe a transaction...");
    expect(html).toContain('type="submit"');
    expect(html).not.toContain("Why did my profit decrease?");
  });
});
