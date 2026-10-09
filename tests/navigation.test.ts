import { describe, expect, it } from "vitest";
import { isNavigationActive, mainNavigation } from "@/lib/navigation";

describe("main app navigation", () => {
  it("links the implemented pages and marks only the current route active", () => {
    expect(mainNavigation).toEqual([
      { label: "Home", href: "/" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "AI Analyst", href: "/chat" },
      { label: "General Ledger", href: "/ledger" },
    ]);
    for (const route of ["/", "/dashboard", "/chat", "/ledger"]) {
      expect(mainNavigation.filter(({ href }) => isNavigationActive(route, href))).toHaveLength(1);
    }
    expect(isNavigationActive("/dashboard", "/chat")).toBe(false);
  });
});
