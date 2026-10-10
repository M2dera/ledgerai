import { describe, expect, it } from "vitest";
import { analyzeData } from "@/lib/analysis/analyzer";
import { mapFinancialDatasetToAccounting } from "@/lib/accounting";
import type { FinancialDataset, IngestionResult, UploadedFile } from "@/lib/financial/types";

const uploadedFile: UploadedFile = {
  id: "integration-fixture",
  name: "financial.csv",
  size: 100,
  type: "text/csv",
  uploadedAt: "2026-01-01T00:00:00.000Z",
};

function dataset(rows: IngestionResult["rows"]): FinancialDataset {
  return analyzeData(
    { columns: ["Date", "Category", "Amount", "Currency"], rows, warnings: [], errors: [] },
    uploadedFile,
  );
}

describe("financial data to accounting integration", () => {
  it("maps verified revenue to the Revenue account as a credit balance", () => {
    const result = mapFinancialDatasetToAccounting(dataset([
      { Date: "2026-01-01", Category: "Revenue", Amount: 95_000, Currency: "KWD" },
    ]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.balances).toContainEqual(expect.objectContaining({
      account: expect.objectContaining({ id: "revenue", type: "revenue" }),
      currency: "KWD",
      debitTotal: 0,
      creditTotal: 95_000,
      balance: 95_000,
    }));
  });

  it("maps only recognized expense categories to debit balances", () => {
    const result = mapFinancialDatasetToAccounting(dataset([
      { Date: "2026-01-01", Category: "Rent", Amount: 6_000, Currency: "KWD" },
      { Date: "2026-01-02", Category: "Payroll", Amount: 16_550, Currency: "KWD" },
      { Date: "2026-01-03", Category: "Utilities", Amount: 900, Currency: "KWD" },
    ]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.balances.map(({ account, debitTotal, creditTotal }) => ({ id: account.id, debitTotal, creditTotal }))).toEqual([
      { id: "rent-expense", debitTotal: 6_000, creditTotal: 0 },
      { id: "salaries-expense", debitTotal: 16_550, creditTotal: 0 },
      { id: "utilities-expense", debitTotal: 900, creditTotal: 0 },
    ]);
  });

  it("preserves the verified currency on every mapped balance", () => {
    const result = mapFinancialDatasetToAccounting(dataset([
      { Date: "2026-01-01", Category: "Revenue", Amount: 100, Currency: "KWD" },
      { Date: "2026-01-02", Category: "Rent", Amount: 25, Currency: "KWD" },
    ]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe("KWD");
    expect(result.value.balances.every((balance) => balance.currency === "KWD")).toBe(true);
  });

  it("rejects missing or ambiguous currency rather than assuming one", () => {
    const unknown = analyzeData(
      { columns: ["Category", "Amount"], rows: [{ Category: "Revenue", Amount: 100 }], warnings: [], errors: [] },
      uploadedFile,
    );
    const mixed = analyzeData(
      {
        columns: ["Category", "Amount", "Currency"],
        rows: [
          { Category: "Revenue", Amount: 100, Currency: "KWD" },
          { Category: "Rent", Amount: 20, Currency: "USD" },
        ],
        warnings: [],
        errors: [],
      },
      uploadedFile,
    );

    expect(mapFinancialDatasetToAccounting(unknown)).toMatchObject({ ok: false, errors: [{ code: "CURRENCY_UNAVAILABLE" }] });
    expect(mapFinancialDatasetToAccounting(mixed)).toMatchObject({ ok: false, errors: [{ code: "CURRENCY_UNAVAILABLE" }] });
  });

  it("rejects ambiguous categories and never fabricates balancing journal entries", () => {
    const result = mapFinancialDatasetToAccounting(dataset([
      { Date: "2026-01-01", Category: "Revenue", Amount: 100, Currency: "KWD" },
      { Date: "2026-01-02", Category: "Marketing", Amount: 20, Currency: "KWD" },
    ]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.balances.map(({ account }) => account.id)).toEqual(["revenue"]);
    expect(result.value.journalEntries).toEqual([]);
    expect(result.value.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNMAPPED_EXPENSE_CATEGORY", rowNumber: 2 }),
      expect.objectContaining({ code: "MISSING_COUNTER_ACCOUNT", rowNumber: 1 }),
    ]));
  });

  it("returns no fabricated output when no row has an unambiguous account mapping", () => {
    const result = mapFinancialDatasetToAccounting(dataset([
      { Date: "2026-01-01", Category: "Marketing", Amount: 20, Currency: "KWD" },
    ]));

    expect(result).toMatchObject({
      ok: false,
      errors: [
        { code: "NO_MAPPABLE_DATA" },
        { code: "UNMAPPED_EXPENSE_CATEGORY", rowNumber: 1 },
      ],
    });
  });
});
