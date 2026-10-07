import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { analyzeData, createUploadedFile } from "@/lib/analysis/analyzer";
import { classifyFinancialQuestion, routeFinancialQuestion } from "@/lib/analysis/chat";
import { createFinancialContext } from "@/lib/ai/context";
import { completeCategoryFactRefs, validateInterpretation } from "@/lib/ai/validation";
import type { AnalystInterpretation } from "@/lib/ai/types";
import { readExcel } from "@/lib/excel/reader";

async function actualDataset() {
  const bytes = await readFile("test-data/LedgerAI_test_financial_data.xlsx");
  const file = new File([bytes], "LedgerAI_test_financial_data.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  return analyzeData(await readExcel(file), createUploadedFile(file));
}

const analystResponse: AnalystInterpretation = {
  provider: "ollama",
  interpretation: "Payroll is the leading verified expense category and should be reviewed against the period evidence.",
  investigateNext: ["Review Payroll alongside its recent category change."],
  uncertainty: [],
  factRefs: [],
};

describe("dataset-grounded analyst routing and context", () => {
  it("answers the Arabic highest-expense question deterministically from the actual workbook", async () => {
    const dataset = await actualDataset();
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeFinancialQuestion("شنو أكثر مصروف عندي؟", dataset, analyst);

    expect(classifyFinancialQuestion("شنو أكثر مصروف عندي؟", dataset)).toBe("category_ranking");
    expect(result).toMatchObject({ route: "local", intent: "category_ranking" });
    expect(result.route === "local" ? result.text : "").toContain("Payroll");
    expect(result.route === "local" ? result.text : "").toContain("16,550 KWD");
    expect(analyst).not.toHaveBeenCalled();
  });

  it("answers natural Arabic and English category-amount questions from analyzed rows", async () => {
    const dataset = await actualDataset();
    const analyst = vi.fn(async () => analystResponse);
    const cases = [
      ["كم الرواتب؟", "Payroll", "16,550 KWD", "category_metric"],
      ["كم الإيجار؟", "Rent", "6,000 KWD", "category_metric"],
      ["كم صرفت على التسويق؟", "Marketing", "4,420 KWD", "category_metric"],
      ["What is my highest expense?", "Payroll", "16,550 KWD", "category_ranking"],
    ] as const;
    for (const [question, label, amount, intent] of cases) {
      const result = await routeFinancialQuestion(question, dataset, analyst);
      expect(result).toMatchObject({ route: "local", intent });
      expect(result.route === "local" ? result.text : "").toContain(label);
      expect(result.route === "local" ? result.text : "").toContain(amount);
    }
    expect(analyst).not.toHaveBeenCalled();
  });

  it("answers the requested Arabic profit, revenue, and expense totals deterministically", async () => {
    const dataset = await actualDataset();
    const analyst = vi.fn(async () => analystResponse);
    const questions: Array<[string, string]> = [
      ["\u0643\u0645 \u0635\u0627\u0641\u064A \u0627\u0644\u0631\u0628\u062D\u061F", "67,130"],
      ["\u0643\u0645 \u0627\u0644\u0631\u0628\u062D\u061F", "67,130"],
      ["\u0634\u0643\u062B\u0631 \u0627\u0644\u0631\u0628\u062D\u061F", "67,130"],
      ["\u0634\u0646\u0648 \u0635\u0627\u0641\u064A \u0627\u0644\u0631\u0628\u062D\u061F", "67,130"],
      ["\u0643\u0645 \u0627\u0644\u0631\u0628\u062D \u0627\u0644\u0635\u0627\u0641\u064A\u061F", "67,130"],
      ["\u0634\u0643\u062B\u0631 \u0637\u0644\u0639 \u0627\u0644\u0631\u0628\u062D\u061F", "67,130"],
      ["\u0643\u0645 \u0627\u0644\u0623\u0631\u0628\u0627\u062D\u061F", "67,130"],
      ["\u0643\u0645 \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0625\u064A\u0631\u0627\u062F\u0627\u062A\u061F", "95,000"],
      ["\u0643\u0645 \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641\u061F", "27,870"],
      ["\u0634\u0643\u062B\u0631 \u0627\u0644\u0645\u0635\u0627\u0631\u064A\u0641\u061F", "27,870"],
      ["\u0634\u0643\u062B\u0631 \u0627\u0644\u0625\u064A\u0631\u0627\u062F\u0627\u062A\u061F", "95,000"],
    ];

    for (const [question, expectedAmount] of questions) {
      expect(classifyFinancialQuestion(question, dataset)).toBe("deterministic_metric");
      const result = await routeFinancialQuestion(question, dataset, analyst);
      expect(result).toMatchObject({ route: "local", intent: "deterministic_metric" });
      expect(result.route === "local" ? result.text : "").toContain(expectedAmount);
      expect(result.route === "local" ? result.text : "").toContain("KWD");
    }

    expect(analyst).not.toHaveBeenCalled();
  });

  it("routes 'where is the problem' with ranked categories, shares, and verified trend signals", async () => {
    const dataset = await actualDataset();
    const fullContext = createFinancialContext(dataset);
    expect(fullContext.trends.map((trend) => trend.metric)).toEqual(["revenue", "expenses", "profit"]);
    expect(fullContext.categoryChanges.length).toBeGreaterThan(0);
    expect(fullContext.periods.map(({ id, revenue, expenses, profit }) => [id, revenue, expenses, profit])).toEqual([
      ["2026-01", 15800, 4930, 10870], ["2026-02", 17550, 5250, 12300], ["2026-03", 19050, 5580, 13470], ["2026-04", 20600, 5880, 14720], ["2026-05", 22000, 6230, 15770],
    ]);
    expect(fullContext.comparisons.at(-1)).toMatchObject({ revenueDelta: 1400, expenseDelta: 350, profitDelta: 1050 });
    expect(fullContext.categoryChanges.map((change) => change.label.value)).toEqual(["Payroll", "Rent", "Marketing", "Software"]);
    expect(fullContext.largestChanges.positive || fullContext.largestChanges.negative).toBeTruthy();
    let received: ReturnType<typeof createFinancialContext> | undefined;
    const result = await routeFinancialQuestion("وين تشوف المشكلة؟", dataset, async ({ context }) => {
      received = context;
      return { ...analystResponse, factRefs: [context.categories[0].factId] };
    });

    expect(result).toMatchObject({ route: "analyst", intent: "interpretive_financial" });
    expect(received?.categories[0]).toMatchObject({ rank: 1, label: { value: "Payroll" }, expenses: 16550 });
    expect(received?.facts.slice(0, 2).map((fact) => fact.label)).toEqual(["Payroll", "Payroll expense share percent"]);
    expect(received?.categories[0].sharePercent).toBeCloseTo(59.38, 2);
    expect(received?.categories.slice(0, 4).map((category) => [category.label.value, category.expenses])).toEqual([
      ["Payroll", 16550], ["Rent", 6000], ["Marketing", 4420], ["Software", 900],
    ]);
    expect(received?.categories.every((category) => received?.facts.some((fact) => fact.id === category.factId))).toBe(true);
    expect(received?.periods.length).toBeGreaterThan(1);
    expect(received?.comparisons.length).toBeGreaterThan(0);
    expect(received?.trends.map((trend) => trend.metric)).toEqual(["revenue", "expenses", "profit"]);
    expect(received?.facts.filter((fact) => fact.kind === "comparison").map((fact) => fact.label.replace(/^.*? to .*? (revenue|expenses|profit) delta$/, "$1"))).toEqual(["revenue", "expenses", "profit"]);
    expect(received?.categoryChanges).toEqual([]);
  });

  it("routes profit-change and review questions with period comparisons and ranked drivers", async () => {
    const dataset = await actualDataset();
    let profitContext: ReturnType<typeof createFinancialContext> | undefined;
    const profitChange = await routeFinancialQuestion("ليش الربح تغير؟", dataset, async ({ context }) => {
      profitContext = context;
      return {
        ...analystResponse,
        factRefs: context.facts.filter((fact) => fact.kind === "comparison" && /profit delta/.test(fact.label)).slice(0, 2).map((fact) => fact.id),
      };
    });
    const review = await routeFinancialQuestion("شنو تنصحني أراجع؟", dataset, async ({ context }) => ({
      ...analystResponse,
      factRefs: context.categories.slice(0, 2).map((category) => category.factId),
    }));

    expect(profitChange).toMatchObject({ route: "analyst", intent: "interpretive_financial" });
    expect(profitContext?.facts.slice(0, 3).map((fact) => fact.label.replace(/^.*? to .*? (revenue|expenses|profit) delta$/, "$1"))).toEqual(["revenue", "expenses", "profit"]);
    expect(review).toMatchObject({ route: "analyst", intent: "recommendation_investigation" });
    expect(classifyFinancialQuestion("ليش الربح تغير؟", dataset)).toBe("interpretive_financial");
    expect(classifyFinancialQuestion("شنو تنصحني أراجع؟", dataset)).toBe("recommendation_investigation");
  });

  it("rejects unsupported concepts and requires relevant known fact references", async () => {
    const context = createFinancialContext(await actualDataset());
    const payrollId = context.categories[0].factId;
    const grounded = {
      ...analystResponse,
      interpretation: "Payroll is the leading verified expense category.",
      investigateNext: ["Review Payroll using the supplied expense evidence."],
      factRefs: [payrollId],
    };
    expect(validateInterpretation(grounded, context)).toBe(true);
    expect(validateInterpretation({ ...grounded, interpretation: "Transfers are causing the expense pressure." }, context)).toBe(false);
    expect(validateInterpretation({ ...grounded, interpretation: "التحويلات تفسر ضغط المصاريف." }, context)).toBe(false);
    expect(validateInterpretation({ ...grounded, interpretation: "المصاريف زادت ثلاث مرات." }, context)).toBe(false);
    expect(validateInterpretation({ ...grounded, interpretation: "المبالغ بالدينار الكويتي." }, context)).toBe(false);
    expect(validateInterpretation({ ...grounded, interpretation: "Utilities are the issue for Payroll." }, context)).toBe(false);
    expect(validateInterpretation({ ...grounded, interpretation: "Payroll was the concern in July." }, context)).toBe(false);
    expect(validateInterpretation({ ...grounded, interpretation: "حدث ذلك في يوليو." }, context)).toBe(false);
    expect(validateInterpretation({ ...grounded, interpretation: "Revenue is declining.", factRefs: [payrollId] }, context)).toBe(false);
    expect(validateInterpretation({ ...grounded, factRefs: ["fact-deadbeef"] }, context)).toBe(false);
    expect(validateInterpretation({ ...grounded, factRefs: [] }, context)).toBe(false);
    const categoryMention = { provider: "ollama", interpretation: "Payroll should be reviewed.", investigateNext: [], uncertainty: [], factRefs: [] };
    const completedRefs = completeCategoryFactRefs(categoryMention, context, new Set([payrollId]));
    expect(completedRefs).toMatchObject({ factRefs: [payrollId] });
    expect(validateInterpretation(completedRefs, context)).toBe(true);
    const gulfRecommendation = "\u0634\u0646\u0648 \u062A\u0646\u0635\u062D\u0646\u064A \u0623\u0631\u0627\u062C\u0639\u061F";
    const arabicGrounded = { ...grounded, interpretation: "\u0631\u0627\u062C\u0639 \u0627\u0644\u0641\u0626\u0627\u062A \u0627\u0644\u0623\u0639\u0644\u0649.", investigateNext: [], factRefs: [payrollId] };
    expect(validateInterpretation(arabicGrounded, context, gulfRecommendation)).toBe(true);
    const translatedCategory = { provider: "ollama", interpretation: "\u0631\u0627\u062C\u0639 \u0627\u0644\u0631\u0648\u0627\u062A\u0628 و\u0627\u0644\u0625\u064A\u062C\u0627\u0631.", investigateNext: [], uncertainty: [], factRefs: [] };
    const translatedCategoryRefs = completeCategoryFactRefs(translatedCategory, context, new Set(context.categories.slice(0, 3).map((category) => category.factId)));
    expect(translatedCategoryRefs).toMatchObject({ factRefs: [payrollId, context.categories[1].factId] });
    expect(validateInterpretation(translatedCategoryRefs, context, gulfRecommendation)).toBe(true);
    expect(validateInterpretation(grounded, context, "وين تشوف المشكلة؟")).toBe(true);
    expect(validateInterpretation({ ...grounded, factRefs: [context.facts.find((fact) => fact.label === "revenue")!.id] }, context, "وين تشوف المشكلة؟")).toBe(false);
    const profitComparison = context.facts.find((fact) => fact.kind === "comparison" && /profit delta/.test(fact.label))!;
    const pair = profitComparison.label.replace(/\s+profit delta$/, "");
    const profitDriverRefs = [profitComparison.id, ...["revenue", "expenses"].map((metric) => context.facts.find((fact) => fact.label === `${pair} ${metric} delta`)!.id)];
    const profitInterpretation = { ...grounded, interpretation: "Profit is moving with the supplied period evidence.", investigateNext: ["Review the period comparison."], factRefs: profitDriverRefs };
    expect(validateInterpretation(profitInterpretation, context, "ليش الربح تغير؟")).toBe(true);
    expect(validateInterpretation({ ...profitInterpretation, factRefs: [profitComparison.id] }, context, "ليش الربح تغير؟")).toBe(false);
    const unrelatedComparison = context.facts.find((fact) => fact.kind === "comparison" && /revenue delta/.test(fact.label))!;
    expect(validateInterpretation({ ...profitInterpretation, factRefs: [unrelatedComparison.id] }, context, "ليش الربح تغير؟")).toBe(false);
  });

  it("returns explicit uncertainty without calling Ollama when safe financial facts are unavailable", async () => {
    const dataset = analyzeData({
      columns: ["Revenue (KWD)", "Expenses (USD)"],
      rows: [{ "Revenue (KWD)": 100, "Expenses (USD)": 25 }],
      warnings: [],
      errors: [],
    }, { id: "ambiguous", name: "ambiguous.csv", size: 1, type: "text/csv", uploadedAt: "2025-01-01T00:00:00.000Z" });
    const analyst = vi.fn(async () => analystResponse);
    const result = await routeFinancialQuestion("وين تشوف المشكلة؟", dataset, analyst);

    expect(result).toMatchObject({ route: "local", intent: "interpretive_financial" });
    expect(result.route === "local" ? result.text : "").toContain("insufficient");
    expect(analyst).not.toHaveBeenCalled();
  });
});
