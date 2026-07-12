export type FinancialData = {
  totalRows: number;
  revenue: number;
  expenses: number;
  profit: number;
};

const STORAGE_KEY = "ledgerai-financial-data";

export function setFinancialData(data: FinancialData) {
  if (typeof window === "undefined") return;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getFinancialData(): FinancialData | null {
  if (typeof window === "undefined") return null;

  const storedData = localStorage.getItem(STORAGE_KEY);

  if (!storedData) return null;

  try {
    return JSON.parse(storedData) as FinancialData;
  } catch {
    return null;
  }
}