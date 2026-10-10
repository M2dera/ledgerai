import { describe, expect, it } from "vitest";
import { isNavigationActive, mainNavigation } from "@/lib/navigation";

describe("main app navigation", () => {
  it("links the implemented pages and marks only the current route active", () => {
    expect(mainNavigation).toEqual([
      { label: "Home", href: "/" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "AI Analyst", href: "/chat" },
      { label: "General Ledger", href: "/ledger" },
      { label: "Trial Balance", href: "/trial-balance" },
      { label: "Profit & Loss", href: "/profit-loss" },
    ]);
    for (const route of ["/", "/dashboard", "/chat", "/ledger", "/trial-balance", "/profit-loss"]) {
      expect(mainNavigation.filter(({ href }) => isNavigationActive(route, href))).toHaveLength(1);
    }
    expect(isNavigationActive("/dashboard", "/chat")).toBe(false);
  });
});
