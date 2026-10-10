import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatWindow from "@/components/chat/ChatWindow";
import { analyzeData } from "@/lib/analysis/analyzer";
import { createFinancialContext } from "@/lib/ai/context";
import type { AnalystInterpretation } from "@/lib/ai/types";

describe("verified financial fact display", () => {
  it("renders ratio facts as percentages and monetary facts using the verified currency", () => {
    const dataset = analyzeData({
      columns: ["Revenue (KWD)", "Expenses (KWD)"],
      rows: [{ "Revenue (KWD)": 95000, "Expenses (KWD)": 27870 }],
      warnings: [],
      errors: [],
    }, { id: "fact-display", name: "facts.csv", size: 1, type: "text/csv", uploadedAt: "2025-01-01T00:00:00.000Z" });
    const context = createFinancialContext(dataset);
    const interpretation: AnalystInterpretation = {
      provider: "ollama",
      interpretation: "Review the verified measures together.",
      investigateNext: [],
      uncertainty: [],
      factRefs: [],
    };
    const facts = context.facts.map((fact) => ({ label: fact.label, value: fact.value, unit: fact.unit }));
    const html = renderToStaticMarkup(createElement(ChatWindow, {
      messages: [{ sender: "ai", text: "Local interpretation", interpretation, facts }],
    }));

    expect(html).toContain("expense ratio percent: 29.34%");
    expect(html).toContain("profit margin percent: 70.66%");
    expect(html).toContain("revenue: 95,000 KWD");
    expect(html).toContain("expenses: 27,870 KWD");
    expect(html).not.toContain("29.34 KWD");
    expect(html).not.toContain("70.66 KWD");
  });
});
