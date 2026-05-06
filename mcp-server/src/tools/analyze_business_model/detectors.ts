// Detectores determinísticos sobre texto crudo. Sin LLM, sin random.
// Cada uno retorna información estructurada que el handler convierte en facts.

export type RentabilidadPeriod = "daily" | "weekly" | "monthly" | "yearly";

export interface PromesaRentabilidadResult {
  detected: boolean;
  amountPct: number | null;
  period: RentabilidadPeriod | null;
  matches: ReadonlyArray<string>;
}

const PERIOD_TOKENS: ReadonlyArray<{ regex: RegExp; period: RentabilidadPeriod }> = [
  { regex: /\bdiari[oa]s?\b|\bal d[ií]a\b|por d[ií]a/i, period: "daily" },
  { regex: /\bsemanal(?:es)?\b|\bpor semana\b/i, period: "weekly" },
  { regex: /\bmensual(?:es)?\b|\bal mes\b|por mes/i, period: "monthly" },
  { regex: /\banual(?:es)?\b|\bal a[ñn]o\b|por a[ñn]o/i, period: "yearly" },
];

const ASPIRATIONAL_PROMISE: ReadonlyArray<RegExp> = [
  /rentabilidad\s+(?:garantizada|asegurada|del?\s+\d{2,})/i,
  /sin\s+riesgo|libre\s+de\s+riesgo|riesgo\s+cero/i,
  /duplica\s+tu\s+dinero|triplica\s+tu\s+dinero/i,
  /retornos?\s+(?:asegurados?|garantizados?)/i,
];

export function detectaPromesaRentabilidad(text: string): PromesaRentabilidadResult {
  const matches: string[] = [];
  let amountPct: number | null = null;
  let period: RentabilidadPeriod | null = null;

  // Buscar % con período: el primer match con cifra+período toma precedencia.
  const numericMatches = text.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)\s*%(?:\s*([^\n.,;]{0,40}))?/gi);
  for (const m of numericMatches) {
    const numStr = (m[1] ?? "").replace(",", ".");
    const num = Number.parseFloat(numStr);
    if (!Number.isFinite(num) || num <= 0) continue;
    const tail = (m[2] ?? "").trim();
    let foundPeriod: RentabilidadPeriod | null = null;
    for (const { regex, period: p } of PERIOD_TOKENS) {
      if (regex.test(tail)) {
        foundPeriod = p;
        break;
      }
    }
    if (foundPeriod !== null) {
      amountPct = num;
      period = foundPeriod;
      matches.push(m[0].trim());
      break;
    }
  }

  for (const regex of ASPIRATIONAL_PROMISE) {
    const m = regex.exec(text);
    if (m !== null) matches.push(m[0]);
  }

  return {
    detected: matches.length > 0,
    amountPct,
    period,
    matches,
  };
}

const REFERIDOS_PATTERNS: ReadonlyArray<RegExp> = [
  /\bpor\s+cada\s+referido\b/i,
  /\binvita\s+y\s+gana\b/i,
  /\bgana\s+(?:dinero|comisi[oó]n).{0,30}referidos?\b/i,
  /\b(?:red|plan|sistema)\s+multinivel\b/i,
  /\bcomisi[oó]n\s+(?:multinivel|por\s+cada\s+nivel)\b/i,
  /\bafiliad[oa]s?\s+por\s+cada\s+(?:nivel|capa)\b/i,
];

export function detectaEsquemaReferidos(text: string): boolean {
  return REFERIDOS_PATTERNS.some((p) => p.test(text));
}

export interface LenguajeVagoResult {
  detected: boolean;
  matches: ReadonlyArray<string>;
}

const VAGO_TOKENS: ReadonlyArray<RegExp> = [
  /oportunidad\s+única/i,
  /cupos?\s+limitados?/i,
  /no\s+te\s+lo\s+pierdas/i,
  /acceso\s+exclusivo/i,
  /única\s+oportunidad/i,
  /solo\s+por\s+(?:hoy|24\s*horas)/i,
  /actua\s+(?:ya|ahora)/i,
  /libertad\s+financiera/i,
  /retiro\s+anticipado/i,
];

export function detectaLenguajeVago(text: string): LenguajeVagoResult {
  const matches: string[] = [];
  for (const regex of VAGO_TOKENS) {
    const m = regex.exec(text);
    if (m !== null) matches.push(m[0]);
  }
  return {
    detected: matches.length >= 2,
    matches,
  };
}

export interface AusenciaInfoLegalResult {
  detected: boolean;
  hasRut: boolean;
  hasRazonSocial: boolean;
  hasDireccion: boolean;
}

const RAZON_SOCIAL_TOKENS: ReadonlyArray<RegExp> = [
  /\bSpA\b/i,
  /\bS\.?A\.?\b/i,
  /\bLimitada\b/i,
  /\bLtda\b/i,
  /\bE\.?I\.?R\.?L\b/i,
];

const DIRECCION_TOKENS: ReadonlyArray<RegExp> = [
  /\bAv\.?\s+\w+/i,
  /\bAvenida\s+\w+/i,
  /\bcalle\s+\w+/i,
  /\bdirecci[oó]n[:.]\s+\w+/i,
];

export function detectaAusenciaInfoLegal(text: string): AusenciaInfoLegalResult {
  const hasRut = /\b\d{1,3}(?:\.\d{3}){2}-[\dkK]\b|\b\d{7,9}-[\dkK]\b/.test(text);
  const hasRazonSocial = RAZON_SOCIAL_TOKENS.some((r) => r.test(text));
  const hasDireccion = DIRECCION_TOKENS.some((r) => r.test(text));
  // Flag si falta al menos 2 de los 3 indicadores.
  const present = [hasRut, hasRazonSocial, hasDireccion].filter(Boolean).length;
  return {
    detected: present <= 1,
    hasRut,
    hasRazonSocial,
    hasDireccion,
  };
}

/** Anualiza una promesa de rentabilidad para comparar contra TMC. */
export function annualizePct(amountPct: number, period: RentabilidadPeriod): number {
  switch (period) {
    case "daily":
      return amountPct * 365;
    case "weekly":
      return amountPct * 52;
    case "monthly":
      return amountPct * 12;
    case "yearly":
      return amountPct;
  }
}
