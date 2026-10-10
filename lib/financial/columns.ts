import type { FinancialField } from "./types";

const aliases: Record<FinancialField, string[]> = {
  date: ["date", "transaction date", "تاريخ", "التاريخ"],
  description: ["description", "details", "memo", "narration", "البيان", "الوصف", "تفاصيل"],
  category: ["category", "type", "classification", "الفئة", "التصنيف", "النوع"],
  revenue: ["revenue", "income", "sales", "إيراد", "الإيرادات", "دخل", "الدخل", "مبيعات"],
  expense: ["expense", "expenses", "cost", "مصروف", "مصروفات", "نفقات", "التكاليف"],
  amount: ["amount", "value", "total", "المبلغ", "القيمة", "الإجمالي", "اجمالي"],
  debit: ["debit", "dr", "مدين", "المدين"],
  credit: ["credit", "cr", "دائن", "الدائن"],
  profit: ["profit", "net income", "ربح", "الربح", "صافي الربح"],
};

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function aliasScore(header: string, alias: string): number {
  const normalizedAlias = normalizeHeader(alias);
  if (normalizedAlias === "income" && header === "net income") return 0;
  if (header === normalizedAlias) return 100;
  if (header.startsWith(`${normalizedAlias} `) || header.endsWith(` ${normalizedAlias}`)) return 50 + normalizedAlias.length;
  return 0;
}

export type ColumnDetection = {
  detected: Partial<Record<FinancialField, string>>;
  ambiguous: Partial<Record<FinancialField, string[]>>;
  headerScore: number;
};

export function detectColumns(columns: string[]): ColumnDetection {
  const detected: ColumnDetection["detected"] = {};
  const ambiguous: ColumnDetection["ambiguous"] = {};
  let headerScore = 0;

  for (const field of Object.keys(aliases) as FinancialField[]) {
    const matches = columns
      .map((column) => ({
        column,
        score: Math.max(...aliases[field].map((alias) => aliasScore(normalizeHeader(column), alias))),
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!matches.length) continue;
    headerScore += matches[0].score;
    if (matches.length > 1 && matches[0].score === matches[1].score) {
      ambiguous[field] = matches.filter((match) => match.score === matches[0].score).map((match) => match.column);
      continue;
    }
    detected[field] = matches[0].column;
  }

  return { detected, ambiguous, headerScore };
}

export function hasFinancialColumn(detection: ColumnDetection): boolean {
  return ["revenue", "expense", "amount", "debit", "credit", "profit"].some(
    (field) => detection.detected[field as FinancialField] || detection.ambiguous[field as FinancialField],
  );
}
