"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavigationActive, mainNavigation } from "@/lib/navigation";

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="min-h-screen w-64 border-r border-zinc-800 bg-zinc-950 p-6">
      <Link href="/" className="mb-10 block text-3xl font-bold">
        Ledger<span className="text-green-400">AI</span>
      </Link>
      <nav className="space-y-3" aria-label="Main navigation">
        {mainNavigation.map(({ href, label }) => {
          const active = isNavigationActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`block w-full rounded-xl px-4 py-3 font-semibold ${active ? "bg-green-500 text-black" : "text-zinc-300 hover:bg-zinc-900 hover:text-white"}`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-8 border-t border-zinc-800 pt-5">
        <Link href="/sign-in" className="block rounded-xl px-4 py-3 font-semibold text-zinc-400 hover:bg-zinc-900 hover:text-white">
          Identity and company access
        </Link>
      </div>
    </aside>
  );
}
