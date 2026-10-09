export const mainNavigation = [
  { label: "Home", href: "/" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "AI Analyst", href: "/chat" },
  { label: "General Ledger", href: "/ledger" },
  { label: "Trial Balance", href: "/trial-balance" },
] as const;

export function isNavigationActive(pathname: string, href: string): boolean {
  return pathname === href;
}
