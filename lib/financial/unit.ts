import type { FinancialUnit } from "./types";

const currencyPatterns: Array<[string, RegExp]> = [
  ["KWD", /\b(?:KWD|KD)\b|د\.ك|دينار\s*كويتي/i],
  ["SAR", /\bSAR\b|ر\.س|ريال\s*سعودي/i],
  ["AED", /\bAED\b|د\.إ|درهم\s*إماراتي/i],
  ["USD", /\bUSD\b|US\s*\$|\$/i],
  ["EUR", /\bEUR\b|€/i],
  ["GBP", /\bGBP\b|£/i],
  ["CAD", /\bCAD\b/i],
  ["AUD", /\bAUD\b/i],
  ["JPY", /\bJPY\b|¥/i],
];

export function detectFinancialUnit(headers: string[], values: unknown[]): FinancialUnit {
  const headerMatches = new Set<string>();
  for (const header of headers) {
    for (const [code, pattern] of currencyPatterns) if (pattern.test(header)) headerMatches.add(code);
  }
  const candidates = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const [code, pattern] of currencyPatterns) if (pattern.test(value)) candidates.add(code);
  }
  // Symbols such as $ and ¥ are inherently shared by multiple currencies.
  const ambiguousSymbol = values.some((value) => typeof value === "string" && /[$¥]/.test(value));
  const all = new Set([...headerMatches, ...candidates]);
  if (all.size > 1 || (ambiguousSymbol && !headerMatches.size)) {
    return { status: "ambiguous", code: null, source: headerMatches.size ? "header" : "cell", candidates: [...all].sort() };
  }
  if (headerMatches.size === 1) return { status: "known", code: [...headerMatches][0], source: "header", candidates: [...headerMatches] };
  if (candidates.size === 1 && !ambiguousSymbol) return { status: "known", code: [...candidates][0], source: "cell", candidates: [...candidates] };
  if (ambiguousSymbol) return { status: "ambiguous", code: null, source: "cell", candidates: [] };
  return { status: "unknown", code: null, source: "unknown", candidates: [] };
}

export function formatFinancialAmount(value: number, unit: FinancialUnit): string {
  const amount = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit.status === "known" && unit.code ? `${amount} ${unit.code}` : `${amount} (unit unavailable)`;
}
