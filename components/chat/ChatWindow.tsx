type Message = {
  sender: "user" | "ai";
  text: string;
};

type ChatWindowProps = {
  messages: Message[];
};

export default function ChatWindow({
  messages,
}: ChatWindowProps) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 h-[600px] flex flex-col">
      <h2 className="text-2xl font-bold mb-6">
        🤖 LedgerAI Assistant
      </h2>

      <div className="flex-1 overflow-y-auto space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`max-w-[80%] rounded-xl px-4 py-3 ${
              message.sender === "user"
                ? "ml-auto bg-green-500 text-black"
                : "bg-zinc-800 text-white"
            }`}
          >
            {message.text}
          </div>
        ))}
      </div>
    </div>
  );
}