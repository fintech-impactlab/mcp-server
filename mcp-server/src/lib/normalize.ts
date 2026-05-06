// Normalización canónica para comparar nombres de entidades contra dominios,
// URLs o variaciones tipográficas de razón social. Determinístico, sin LLM.
//
// Ejemplos:
//   "Banco Falabella S.A."             → "bancofalabellasa"
//   "https://www.bancofalabella.cl/x"  → "bancofalabella"
//   "BANCO BCI"                        → "bancobci"
//
// Caveat conocido: nombres con conectores ("Banco de Chile" → "bancodechile")
// no matchean dominios sin esos conectores ("bancochile.cl" → "bancochile").
// Esa fragmentación se resolverá con un índice de tokens cuando aparezcan
// más casos; por ahora se documenta como falso negativo aceptable.

const TLD_SUFFIX_RE = /\.(com\.cl|com|org|net|io|co|cl|biz|app)$/;
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(TLD_SUFFIX_RE, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Mínimo de caracteres requeridos para considerar válido un token normalizado
 * en una comparación. Strings vacíos o demasiado cortos producirían falsos
 * positivos masivos vía `includes`.
 */
export const MIN_NORMALIZED_LENGTH = 3;
