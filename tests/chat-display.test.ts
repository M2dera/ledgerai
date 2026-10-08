import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatPage from "@/app/chat/page";
import ChatWindow from "@/components/chat/ChatWindow";
import { useLedgerData } from "@/components/providers/LedgerProvider";
import { createDraftTransaction, createSuggestedTransaction } from "@/lib/accounting/transaction-workflow";
import { approveChatTransaction, routeChatMessage, type ChatMessage } from "@/lib/chat";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));
vi.mock("@/components/providers/LedgerProvider", () => ({ useLedgerData: vi.fn() }));

const metadata = { id: "display-suggestion", date: "2026-10-08" };

afterEach(() => vi.restoreAllMocks());

function findApproveButton(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void }> | undefined {
  if (Array.isArray(node)) return node.map(findApproveButton).find((button) => button !== undefined);
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return undefined;
  if (node.type === "button" && node.props.children === "Approve") return node;
  return findApproveButton(node.props.children);
}

describe("accounting suggestions in chat", () => {
  it("displays the original transaction, accounting lines, and awaiting approval status", async () => {
    const transaction = "دفعت إيجار 600 د.ك من البنك";
    const result = await routeChatMessage(transaction, null, vi.fn(), metadata);
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected a suggestion.");
    const html = renderToStaticMarkup(createElement(ChatWindow, {
      messages: [{ sender: "ai", text: result.text, transaction: createSuggestedTransaction(result.suggestion) }],
      onApprove: vi.fn(),
    }));

    expect(html).toContain("Transaction");
    expect(html).toContain(transaction);
    expect(html).toContain("Suggested Journal Entry");
    expect(html).toContain("Debit Rent Expense: 600 KWD");
    expect(html).toContain("Credit Bank: 600 KWD");
    expect(html).toContain("Awaiting approval");
    expect(html).toContain('type="button"');
    expect(html).toContain(">Approve</button>");
  });

  it("preserves all three accounting decimal places and the explicit currency", async () => {
    const result = await routeChatMessage("paid rent 600.125 USD from cash", null, vi.fn(), metadata);
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected a suggestion.");
    const html = renderToStaticMarkup(createElement(ChatWindow, {
      messages: [{ sender: "ai", text: result.text, transaction: createSuggestedTransaction(result.suggestion) }],
    }));

    expect(html).toContain("Debit Rent Expense: 600.125 USD");
    expect(html).toContain("Credit Cash: 600.125 USD");
  });

  it("approves the reviewed entry only after the user clicks, without changing the displayed lines", async () => {
    const result = await routeChatMessage("دفعت إيجار 600 د.ك من البنك", null, vi.fn(), metadata);
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected a suggestion.");
    let messages: ChatMessage[] = [{ sender: "ai", text: result.text, transaction: createSuggestedTransaction(result.suggestion) }];
    const onApprove = vi.fn((id: string) => { messages = approveChatTransaction(messages, id); });
    const review = ChatWindow({ messages, onApprove });
    const before = renderToStaticMarkup(review);
    expect(before).toContain("Awaiting approval");
    expect(onApprove).not.toHaveBeenCalled();

    const button = findApproveButton(review);
    if (!button?.props.onClick) throw new Error("Expected the explicit Approve action.");
    button.props.onClick();

    expect(onApprove).toHaveBeenCalledWith(metadata.id);
    expect(messages[0]).toMatchObject({ transaction: { status: "approved" } });
    if (messages[0].sender !== "ai") throw new Error("Expected an assistant message.");
    expect(messages[0].transaction?.suggestion).toBe(result.suggestion);
    const after = renderToStaticMarkup(createElement(ChatWindow, { messages, onApprove }));
    expect(after).toContain(">Approved</p>");
    expect(after).toContain("Debit Rent Expense: 600 KWD");
    expect(after).toContain("Credit Bank: 600 KWD");
    expect(after).not.toContain("Awaiting approval");
    expect(after).not.toContain("<button");
  });

  it("shows draft status without allowing approval before review", async () => {
    const result = await routeChatMessage("paid rent 600 KWD from bank", null, vi.fn(), metadata);
    if (result.route !== "transaction" || result.status !== "suggested") throw new Error("Expected a suggestion.");
    const html = renderToStaticMarkup(createElement(ChatWindow, {
      messages: [{ sender: "ai", text: result.text, transaction: createDraftTransaction(result.suggestion) }],
      onApprove: vi.fn(),
    }));

    expect(html).toContain(">Draft</p>");
    expect(html).not.toContain("<button");
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
