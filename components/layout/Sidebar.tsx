import Link from "next/link";

export default function Sidebar() {
  return (
    <aside className="w-64 bg-zinc-950 border-r border-zinc-800 min-h-screen p-6">
      <Link href="/" className="mb-10 block text-3xl font-bold">
        Ledger<span className="text-green-400">AI</span>
      </Link>
      <nav className="space-y-3" aria-label="Main navigation">
        <Link href="/dashboard" className="block w-full rounded-xl bg-green-500 px-4 py-3 font-semibold text-black">Dashboard</Link>
        <Link href="/" className="block w-full rounded-xl px-4 py-3 hover:bg-zinc-900">Files</Link>
        <Link href="/dashboard" className="block w-full rounded-xl px-4 py-3 hover:bg-zinc-900">Analytics</Link>
        <Link href="/chat" className="block w-full rounded-xl px-4 py-3 hover:bg-zinc-900">Data Assistant</Link>
      </nav>
    </aside>
  );
}
