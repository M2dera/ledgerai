import { describe, expect, it, vi } from "vitest";
import { analyzeData } from "@/lib/analysis/analyzer";
import { classifyFinancialQuestion, routeFinancialQuestion } from "@/lib/analysis/chat";
import type { AnalystInterpretation, AnalystRequest } from "@/lib/ai/types";

const dataset = analyzeData({
  columns: ["Revenue", "Expenses", "Category"],
  rows: [
    { Revenue: 900, Expenses: 300, Category: "Rent" },
    { Revenue: 0, Expenses: 100, Category: "Travel" },
  ],
  warnings: [],
  errors: [],
}, { id: "routing-fixture", name: "routing.csv", size: 1, type: "text/csv", uploadedAt: "2025-01-01T00:00:00.000Z" });

const analystResponse: AnalystInterpretation = {
  provider: "ollama",
  interpretation: "The expense mix may be affecting profitability, so review the category evidence.",
  investigateNext: ["Review the categories associated with the recent spending."],
  uncertainty: [],
  factRefs: [],
};

describe("financial chat intent routing", () => {
  it("classifies the reported Arabic analytical and recommendation questions", () => {
    expect(classifyFinancialQuestion("ليش الربح عندي بهالمستوى؟")).toBe("interpretive_financial");
    expect(classifyFinancialQuestion("شنو أكثر شيء يحتاج انتباه في مصاريفي؟")).toBe("recommendation_investigation");
    expect(classifyFinancialQuestion("شنو تنصحني أراجع أول؟")).toBe("recommendation_investigation");
    expect(classifyFinancialQuestion("ليش الربح نازل؟")).toBe("interpretive_financial");
    expect(classifyFinancialQuestion("وين المشكلة في مصاريفي؟")).toBe("interpretive_financial");
    expect(classifyFinancialQuestion("شنو التغيير الأهم؟")).toBe("interpretive_financial");
    expect(classifyFinancialQuestion("شنو الأشياء اللي تستحق التحقيق؟")).toBe("recommendation_investigation");
    expect(classifyFinancialQuestion("هل فيه شيء غير طبيعي؟")).toBe("interpretive_financial");
    expect(classifyFinancialQuestion("شنو أهم ملاحظة عندك عن الوضع المالي؟")).toBe("interpretive_financial");
  });

  it("supports English analytical patterns and keeps direct metric/ranking intents deterministic", () => {
    expect(classifyFinancialQuestion("Why is profit at this level?")).toBe("interpretive_financial");
    expect(classifyFinancialQuestion("What should I review first in expenses?")).toBe("recommendation_investigation");
    expect(classifyFinancialQuestion("What is total revenue?")).toBe("deterministic_metric");
    expect(classifyFinancialQuestion("What are total expenses?")).toBe("deterministic_metric");
    expect(classifyFinancialQuestion("What is profit?")).toBe("deterministic_metric");
    expect(classifyFinancialQuestion("What is the expense ratio?")).toBe("deterministic_metric");
    expect(classifyFinancialQuestion("How much did I spend?")).toBe("deterministic_metric");
    expect(classifyFinancialQuestion("كم ربحي؟")).toBe("deterministic_metric");
    expect(classifyFinancialQuestion("Which categories have the highest expenses?")).toBe("category_ranking");
    expect(classifyFinancialQuestion("Which expense category costs the most?")).toBe("category_ranking");
    expect(classifyFinancialQuestion("شنو أعلى فئة مصاريف؟")).toBe("category_ranking");
    expect(classifyFinancialQuestion("Why is the sky blue?")).toBe("unsupported_general");
  });

  it("answers deterministic questions locally without invoking the analyst", async () => {
    const analyst = vi.fn(async (request: AnalystRequest) => {
      expect(request.question).toBeTruthy();
      return analystResponse;
    });
    const revenue = await routeFinancialQuestion("What is total revenue?", dataset, analyst);
    const highest = await routeFinancialQuestion("Which categories have the highest expenses?", dataset, analyst);
    expect(revenue).toMatchObject({ route: "local", intent: "deterministic_metric" });
    expect(revenue.route === "local" && revenue.text).toContain("900");
    expect(highest).toMatchObject({ route: "local", intent: "category_ranking" });
    expect(highest.route === "local" && highest.text).toContain("Rent");
    expect(analyst).not.toHaveBeenCalled();
  });

  it("routes interpretive and recommendation questions through the analyst callback", async () => {
    const analyst = vi.fn(async (request: AnalystRequest) => {
      expect(request.question).toBeTruthy();
      return analystResponse;
    });
    const interpretive = await routeFinancialQuestion("ليش الربح عندي بهالمستوى؟", dataset, analyst);
    const recommendation = await routeFinancialQuestion("شنو تنصحني أراجع أول؟", dataset, analyst);
    expect(interpretive).toMatchObject({ route: "analyst", intent: "interpretive_financial", interpretation: analystResponse });
    expect(recommendation).toMatchObject({ route: "analyst", intent: "recommendation_investigation", interpretation: analystResponse });
    expect(analyst).toHaveBeenCalledTimes(2);
    expect(analyst.mock.calls[0][0].context.facts.length).toBeGreaterThan(0);
  });

  it("uses the concise safe fallback for unsupported questions", async () => {
    const analyst = vi.fn(async (request: AnalystRequest) => {
      expect(request.question).toBeTruthy();
      return analystResponse;
    });
    const result = await routeFinancialQuestion("Tell me a joke about the weather.", dataset, analyst);
    expect(result).toMatchObject({ route: "local", intent: "unsupported_general" });
    expect(result.route === "local" && result.text).toContain("Ask for a total");
    expect(analyst).not.toHaveBeenCalled();
  });
});
