import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatWindow from "@/components/chat/ChatWindow";
import JournalEntryEditor from "@/components/chat/JournalEntryEditor";
import { suggestJournalEntry } from "@/lib/accounting/suggested-journal-entry";
import { parseTransactionIntent } from "@/lib/accounting/transaction-intent";
import { createAccountingLedgerState } from "@/lib/accounting/transaction-posting";
import { createSuggestedTransaction, type JournalTransactionStatus } from "@/lib/accounting/transaction-workflow";
import { createChatState, editChatTransaction, type ChatState } from "@/lib/chat";

type HookFrame = { values: unknown[]; cursor: number };
const hooks = vi.hoisted(() => ({ active: null as HookFrame | null }));

// Exercise the real component callbacks without a DOM dependency. SSR continues using
// React's own hooks; only direct editor renders use this small state/update harness.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState(initial: unknown) {
      const frame = hooks.active;
      if (!frame) return actual.useState(initial);
      const index = frame.cursor++;
      if (!(index in frame.values)) frame.values[index] = typeof initial === "function" ? initial() : initial;
      return [frame.values[index], (next: unknown) => {
        frame.values[index] = typeof next === "function" ? next(frame.values[index]) : next;
      }];
    },
  };
});

afterEach(() => {
  hooks.active = null;
  vi.restoreAllMocks();
});

const transactionId = "editor-entry";
type EditorProps = ComponentProps<typeof JournalEntryEditor>;
type NodeProps = {
  children?: ReactNode;
  value?: string | number;
  role?: string;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
};

function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<NodeProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function button(node: ReactNode, label: string) {
  return elements(node).find((element) => element.type === "button" && element.props.children === label);
}

function click(node: ReactNode, label: string): void {
  const action = button(node, label)?.props.onClick;
  if (!action) throw new Error(`Expected ${label} action.`);
  action();
}

function field(node: ReactNode, label: string, index = 0) {
  const labels = elements(node).filter((element) => element.type === "label" &&
    elements(element.props.children).some((child) => child.type === "span" && child.props.children === label));
  const input = elements(labels[index]).find((element) => ["input", "textarea", "select"].includes(String(element.type)));
  if (!input?.props.onChange) throw new Error(`Expected ${label} field ${index + 1}.`);
  return input;
}

function change(node: ReactNode, label: string, value: string, index = 0): void {
  field(node, label, index).props.onChange!({ target: { value } });
}

function save(node: ReactNode): void {
  const form = elements(node).find((element) => element.type === "form");
  if (!form?.props.onSubmit) throw new Error("Expected editable journal form.");
  const preventDefault = vi.fn();
  form.props.onSubmit({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
}

function stateFor(status: JournalTransactionStatus = "approved"): ChatState {
  const parsed = parseTransactionIntent("paid rent 600 KWD from bank");
  if (parsed.status !== "resolved") throw new Error("Expected transaction intent.");
  const result = suggestJournalEntry(parsed.intent, { id: transactionId, date: "2026-10-08" });
  if (result.status !== "suggested") throw new Error("Expected validated suggestion.");
  return createChatState([{ sender: "ai", text: "Accounting suggestion", transaction: {
    ...createSuggestedTransaction(result.suggestion), status,
  } }]);
}

function editorHarness(initialState = stateFor()) {
  let state = initialState;
  const frame: HookFrame = { values: [], cursor: 0 };
  const onEdit = vi.fn((id: string, entry: EditorProps["entry"]) => {
    state = editChatTransaction(state, id, entry);
  });
  function render() {
    const chat = ChatWindow({ messages: state.messages, onEdit, editingError: state.editingError,
      onApprove: vi.fn(), onPost: vi.fn() });
    const editor = elements(chat).find((element) => element.type === JournalEntryEditor) as ReactElement<EditorProps> | undefined;
    if (!editor) throw new Error("Expected editor for unposted transaction.");
    frame.cursor = 0;
    hooks.active = frame;
    try {
      return JournalEntryEditor(editor.props);
    } finally {
      hooks.active = null;
    }
  }
  return { render, onEdit, get state() { return state; } };
}

describe("journal entry editing UI", () => {
  it.each(["awaiting_approval", "approved", "posted", "draft"] as const)("offers Edit only for eligible unposted entries: %s", (status) => {
    const state = stateFor(status);
    const html = renderToStaticMarkup(createElement(ChatWindow, {
      messages: state.messages, onApprove: vi.fn(), onPost: vi.fn(), onEdit: vi.fn(),
    }));
    const editable = status === "awaiting_approval" || status === "approved";
    expect(html.includes(">Edit</button>")).toBe(editable);
    expect(html.includes(">Approve</button>")).toBe(status === "awaiting_approval");
    expect(html.includes(">Post</button>")).toBe(status === "approved");
    expect(html).not.toContain(">Save</button>");
  });

  it.each(["awaiting_approval", "approved"] as const)("keeps a failed Save draft and applies a corrected Save atomically from %s", (status) => {
    const ui = editorHarness(stateFor(status));
    const original = ui.state;
    const snapshot = structuredClone(original);
    click(ui.render(), "Edit");
    let view = ui.render();
    expect(button(view, "Approve")).toBeUndefined();
    expect(button(view, "Post")).toBeUndefined();
    change(view, "Description", "Corrected rent journal");
    view = ui.render();
    change(view, "Debit", "650");
    view = ui.render();
    expect(ui.onEdit).not.toHaveBeenCalled();
    expect(ui.state).toBe(original);
    save(view);

    expect(ui.state.messages).toBe(original.messages);
    expect(ui.state.ledger).toBe(original.ledger);
    expect(ui.state.editingError?.message).toContain("must equal credits");
    expect(original).toEqual(snapshot);
    view = ui.render();
    expect(field(view, "Debit").props.value).toBe("650");
    expect(field(view, "Description").props.value).toBe("Corrected rent journal");
    expect(elements(view).some((element) => element.props.role === "alert")).toBe(true);
    expect(button(view, "Save")).toBeDefined();
    expect(button(view, "Approve")).toBeUndefined();
    expect(button(view, "Post")).toBeUndefined();

    change(view, "Credit", "650", 1);
    save(ui.render());
    expect(ui.state.editingError).toBeUndefined();
    expect(ui.state.ledger).toBe(original.ledger);
    expect(ui.state.messages[0]).toMatchObject({ transaction: { status: "awaiting_approval", suggestion: { entry: {
      id: transactionId, description: "Corrected rent journal",
      lines: [{ accountId: "rent-expense", debit: 650, credit: 0 }, { accountId: "bank", debit: 0, credit: 650 }],
    } } } });
    view = ui.render();
    expect(button(view, "Save")).toBeUndefined();
    expect(button(view, "Edit")).toBeDefined();
    expect(button(view, "Approve")).toBeDefined();
    expect(button(view, "Post")).toBeUndefined();
  });

  it("cancels a changed draft without saving, then reopens the original values", () => {
    const ui = editorHarness();
    const original = ui.state;
    click(ui.render(), "Edit");
    change(ui.render(), "Description", "Unsaved change");
    change(ui.render(), "Debit", "700");
    click(ui.render(), "Cancel");

    expect(ui.onEdit).not.toHaveBeenCalled();
    expect(ui.state).toBe(original);
    expect(button(ui.render(), "Post")).toBeDefined();
    click(ui.render(), "Edit");
    const view = ui.render();
    expect(field(view, "Description").props.value).toBe("paid rent 600 KWD from bank");
    expect(field(view, "Debit").props.value).toBe("600");
  });

  it("saves edited dates, currency, accounts, and added lines after removing a spare draft line", () => {
    const ui = editorHarness();
    const ledger = ui.state.ledger;
    click(ui.render(), "Edit");
    change(ui.render(), "Date", "2026-10-15");
    change(ui.render(), "Currency", "usd");
    change(ui.render(), "Account", "cash", 1);
    change(ui.render(), "Debit", "500");
    click(ui.render(), "Add line");
    change(ui.render(), "Account", "utilities-expense", 2);
    change(ui.render(), "Debit", "100", 2);
    click(ui.render(), "Add line");
    const remove = elements(ui.render()).filter((element) =>
      element.type === "button" && element.props.children === "Remove line")[3]?.props.onClick;
    if (!remove) throw new Error("Expected the spare draft line's Remove action.");
    remove();
    save(ui.render());

    expect(ui.state.editingError).toBeUndefined();
    expect(ui.state.ledger).toBe(ledger);
    expect(ui.state.messages[0]).toMatchObject({ transaction: {
      status: "awaiting_approval",
      suggestion: { entry: {
        id: transactionId, date: "2026-10-15", currency: "USD",
        lines: [
          { accountId: "rent-expense", debit: 500, credit: 0 },
          { accountId: "cash", debit: 0, credit: 600 },
          { accountId: "utilities-expense", debit: 100, credit: 0 },
        ],
      } },
    } });
    expect(button(ui.render(), "Save")).toBeUndefined();
  });

  it("rejects a blank amount without silently saving a zero", () => {
    const ui = editorHarness();
    const original = ui.state;
    click(ui.render(), "Edit");
    change(ui.render(), "Credit", "", 0);
    save(ui.render());

    expect(ui.state.messages).toBe(original.messages);
    expect(ui.state.ledger).toBe(original.ledger);
    expect(ui.state.editingError?.message).toContain("non-finite");
    expect(field(ui.render(), "Credit").props.value).toBe("");
    expect(button(ui.render(), "Save")).toBeDefined();
  });

  it("keeps a mixed-currency draft visible and preserves a populated ledger after rejection", () => {
    const state = stateFor();
    state.ledger = createAccountingLedgerState([{
      id: "opening-capital", date: "2026-10-01", description: "Opening capital", currency: "KWD",
      lines: [{ accountId: "bank", debit: 1000, credit: 0 }, { accountId: "owners-equity", debit: 0, credit: 1000 }],
    }]);
    const ui = editorHarness(state);
    const ledgerBefore = structuredClone(state.ledger);
    click(ui.render(), "Edit");
    change(ui.render(), "Currency", "USD");
    save(ui.render());

    expect(ui.state.messages).toBe(state.messages);
    expect(ui.state.ledger).toBe(state.ledger);
    expect(ui.state.ledger).toEqual(ledgerBefore);
    expect(ui.state.editingError?.message).toContain("require one currency");
    expect(field(ui.render(), "Currency").props.value).toBe("USD");
    expect(elements(ui.render()).some((element) => element.props.role === "alert")).toBe(true);
    expect(button(ui.render(), "Post")).toBeUndefined();
  });
});
