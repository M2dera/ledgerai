export const mainNavigation = [
  { label: "Home", href: "/" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "AI Analyst", href: "/chat" },
] as const;

export function isNavigationActive(pathname: string, href: string): boolean {
  return pathname === href;
}
