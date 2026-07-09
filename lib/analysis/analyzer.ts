type DataRow = Record<string, unknown>;

export type FinancialAnalysis = {
  totalRows: number;
  columns: string[];
  revenue: number;
  expenses: number;
  profit: number;
};

function normalizeColumnName(column: string) {
  return column.toLowerCase().trim();
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const number = Number(cleaned);
    return Number.isNaN(number) ? 0 : number;
  }

  return 0;
}

function findColumn(columns: string[], keywords: string[]) {
  return columns.find((column) => {
    const name = normalizeColumnName(column);

    return keywords.some((keyword) => name.includes(keyword));
  });
}

export function analyzeData(rows: DataRow[]): FinancialAnalysis {
  if (rows.length === 0) {
    return {
      totalRows: 0,
      columns: [],
      revenue: 0,
      expenses: 0,
      profit: 0,
    };
  }

  const columns = Object.keys(rows[0]);

  const categoryColumn = findColumn(columns, ["category", "type", "classification"]);
  const amountColumn = findColumn(columns, ["amount", "value", "total"]);

  let revenue = 0;
  let expenses = 0;

  if (categoryColumn && amountColumn) {
    rows.forEach((row) => {
      const category = String(row[categoryColumn]).toLowerCase().trim();
      const amount = toNumber(row[amountColumn]);

      if (
        category.includes("revenue") ||
        category.includes("sales") ||
        category.includes("income")
      ) {
        revenue += amount;
      }

      if (
        category.includes("expense") ||
        category.includes("cost") ||
        category.includes("spend") ||
        amount < 0
      ) {
        expenses += Math.abs(amount);
      }
    });
  }

  const profit = revenue - expenses;

  return {
    totalRows: rows.length,
    columns,
    revenue,
    expenses,
    profit,
  };
}