// Utilidades RUT chileno: limpieza canónica + cálculo del dígito verificador
// (algoritmo módulo 11). El formato canónico es "<numérico>-<DV>" sin puntos
// y con DV en mayúscula (ej. "76123456-7", "5126663-K").

const RUT_RE = /^\s*(\d{1,3}(?:\.\d{3}){0,2}|\d{1,9})(?:-?([\dkK]))?\s*$/;

export interface NormalizedRut {
  /** RUT sin puntos, con DV calculado o validado, en formato "NNNN-D". null si no parseable. */
  canonical: string | null;
  /** Parte numérica como string ("76123456"). null si no parseable. */
  numeric: string | null;
  /** Dígito verificador (calculado o presente en input). null si no parseable. */
  dv: string | null;
  /** true si el DV provisto coincide con el calculado, o si lo calculamos nosotros. */
  validDV: boolean;
  /** true si el input venía sin DV y lo calculamos. */
  dvWasComputed: boolean;
}

/**
 * Algoritmo módulo 11 oficial chileno.
 * @param numeric String de dígitos sin puntos ni DV.
 * @returns Carácter "0".."9" o "K".
 */
export function computeDV(numeric: string): string {
  let sum = 0;
  let multiplier = 2;
  for (let i = numeric.length - 1; i >= 0; i -= 1) {
    sum += Number.parseInt(numeric[i] ?? "0", 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return "0";
  if (remainder === 10) return "K";
  return String(remainder);
}

export function normalizeRut(raw: string): NormalizedRut {
  const empty: NormalizedRut = {
    canonical: null,
    numeric: null,
    dv: null,
    validDV: false,
    dvWasComputed: false,
  };
  if (typeof raw !== "string") return empty;
  const match = RUT_RE.exec(raw);
  if (match === null) return empty;
  const numeric = (match[1] ?? "").replace(/\./g, "");
  if (numeric.length === 0) return empty;
  const providedDV = match[2] !== undefined ? match[2].toUpperCase() : null;
  const computed = computeDV(numeric);
  if (providedDV === null) {
    return {
      canonical: `${numeric}-${computed}`,
      numeric,
      dv: computed,
      validDV: true,
      dvWasComputed: true,
    };
  }
  const validDV = providedDV === computed;
  return {
    canonical: `${numeric}-${providedDV}`,
    numeric,
    dv: providedDV,
    validDV,
    dvWasComputed: false,
  };
}
