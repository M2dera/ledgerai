"use client";

import { createContext, useContext, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createChatState, type ChatState } from "@/lib/chat";

type AccountingSessionContextValue = {
  chat: ChatState;
  setChat: Dispatch<SetStateAction<ChatState>>;
  nextTransactionId: (kind: "suggestion" | "reversal") => string;
};

const AccountingSessionContext = createContext<AccountingSessionContextValue | null>(null);

export function AccountingSessionProvider({ children }: { children: React.ReactNode }) {
  const [chat, setChat] = useState(() => createChatState([
    { sender: "ai", text: "Ask about your uploaded financial data or describe a transaction for a validated accounting suggestion. Review or edit an unposted entry, approve it, then explicitly post it to the session ledger. Editing an approved entry requires approval again. Reverse creates a separate entry that also requires approval and posting. Transactions remain available while navigating this session. Refreshing the page clears chat and the session ledger." },
  ]));
  const transactionSequence = useRef(0);

  function nextTransactionId(kind: "suggestion" | "reversal") {
    return `chat-${kind}-${++transactionSequence.current}`;
  }

  return <AccountingSessionContext.Provider value={{ chat, setChat, nextTransactionId }}>{children}</AccountingSessionContext.Provider>;
}

export function useAccountingSession(): AccountingSessionContextValue {
  const context = useContext(AccountingSessionContext);
  if (!context) throw new Error("useAccountingSession must be used within AccountingSessionProvider.");
  return context;
}
