import type { FinancialFactUnit, FinancialUnit } from "./types";

const currencyPatterns: Array<[string, RegExp]> = [
  ["KWD", /\b(?:KWD|KD)\b|\u062f\s*\.?\s*\u0643|\u062f\u064a\u0646\u0627\u0631\s*\u0643\u0648\u064a\u062a\u064a/i],
  ["SAR", /\bSAR\b|\u0631\s*\.?\s*\u0633|\u0631\u064a\u0627\u0644\s*\u0633\u0639\u0648\u062f\u064a/i],
  ["AED", /\bAED\b|\u062f\s*\.?\s*\u0625|\u062f\u0631\u0647\u0645\s*\u0625\u0645\u0627\u0631\u0627\u062a\u064a/i],
  ["USD", /\bUSD\b|US\s*\$|\$/i],
  ["EUR", /\bEUR\b|\u20ac/i],
  ["GBP", /\bGBP\b|\u00a3/i],
  ["CAD", /\bCAD\b/i],
  ["AUD", /\bAUD\b/i],
  ["JPY", /\bJPY\b|\u00a5/i],
];

function normalizeCurrencyText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[\s.]/g, "").trim();
}

export function isCurrencyHeader(header: string): boolean {
  const normalized = normalizeCurrencyText(header);
  return normalized === "currency" || normalized === "\u0627\u0644\u0639\u0645\u0644\u0629" || normalized === "\u0627\u0644\u0639\u0645\u0644\u0647";
}

function explicitCurrencyCode(value: unknown): string | null {
  const normalized = normalizeCurrencyText(value);
  if (["kwd", "kd", "\u062f\u0643", "\u0627\u0644\u0643\u0648\u064a\u062a", "kuwait", "\u062f\u064a\u0646\u0627\u0631\u0643\u0648\u064a\u062a\u064a"].includes(normalized)) return "KWD";
  if (/^\$+$/.test(String(value ?? "").trim())) return null;
  for (const [code, pattern] of currencyPatterns) if (pattern.test(String(value ?? ""))) return code;
  return null;
}

export function detectFinancialUnit(headers: string[], values: unknown[], explicitCurrencyValues?: unknown[]): FinancialUnit {
  const headerMatches = new Set<string>();
  for (const header of headers) {
    for (const [code, pattern] of currencyPatterns) if (pattern.test(header)) headerMatches.add(code);
  }
  const candidates = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const [code, pattern] of currencyPatterns) if (pattern.test(value)) candidates.add(code);
  }
  const ambiguousSymbol = values.some((value) => typeof value === "string" && /[$\u00a5]/.test(value));

  if (explicitCurrencyValues) {
    const explicitValues = explicitCurrencyValues.filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
    const explicitCodes = explicitValues.map(explicitCurrencyCode);
    const explicitCandidates = new Set(explicitCodes.filter((code): code is string => code !== null));
    const missingOrUnrecognized = explicitValues.length !== explicitCurrencyValues.length || explicitCodes.some((code) => code === null);
    const combined = new Set([...headerMatches, ...candidates, ...explicitCandidates]);
    if (missingOrUnrecognized || explicitCandidates.size > 1 || combined.size > 1) {
      return { status: "ambiguous", code: null, source: "cell", candidates: [...combined].sort() };
    }
    if (explicitCandidates.size === 1) {
      const [code] = explicitCandidates;
      return { status: "known", code, source: "cell", candidates: [code] };
    }
  }

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

export function formatFinancialFactValue(value: number, unit: FinancialFactUnit): string {
  const amount = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit.kind === "percentage" ? `${amount}%` : formatFinancialAmount(value, unit.unit);
}
