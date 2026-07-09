export default function Sidebar() {
  return (
    <aside className="w-64 bg-zinc-950 border-r border-zinc-800 min-h-screen p-6">

      <h1 className="text-3xl font-bold mb-10">
        Ledger<span className="text-green-400">AI</span>
      </h1>

      <nav className="space-y-3">

        <button className="w-full text-left bg-green-500 text-black font-semibold px-4 py-3 rounded-xl">
          Dashboard
        </button>

        <button className="w-full text-left px-4 py-3 hover:bg-zinc-900 rounded-xl">
          Files
        </button>

        <button className="w-full text-left px-4 py-3 hover:bg-zinc-900 rounded-xl">
          Analytics
        </button>

        <button className="w-full text-left px-4 py-3 hover:bg-zinc-900 rounded-xl">
          AI Chat
        </button>

        <button className="w-full text-left px-4 py-3 hover:bg-zinc-900 rounded-xl">
          Reports
        </button>

        <button className="w-full text-left px-4 py-3 hover:bg-zinc-900 rounded-xl">
          Settings
        </button>

      </nav>

    </aside>
  );
}