export const mainNavigation = [
  { label: "Home", href: "/" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "AI Analyst", href: "/chat" },
  { label: "General Ledger", href: "/ledger" },
] as const;

export function isNavigationActive(pathname: string, href: string): boolean {
  return pathname === href;
}
