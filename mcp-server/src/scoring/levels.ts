// Escalas de niveles de confianza (semáforo de 5 estados) por perfil.
// Cada perfil tiene su propio rango porque el conjunto de reglas aplicables
// es distinto: CMF [-745, +115] vs No-CMF [-380, +15]. Los umbrales vienen
// del simulador `scoring_extension_chrome_v3.xlsx` (hoja Niveles) y son
// editables por el equipo legal — modificar acá implica re-aprobación.

import type { ScoreProfile } from "./engine.js";

export type LevelId = 1 | 2 | 3 | 4 | 5;
export type LevelLabel =
  | "Crítico"
  | "Riesgoso"
  | "Neutro"
  | "Confiable"
  | "Muy confiable";

export interface LevelEntry {
  readonly id: LevelId;
  readonly label: LevelLabel;
  /** Score mínimo (inclusivo) para caer en este nivel. */
  readonly minScore: number;
}

/** Sentinela: el nivel 1 absorbe todo lo que esté por debajo del umbral del 2. */
const FLOOR = -9999;

/** Escala para sitios que SÍ deberían estar regulados por la CMF. */
export const SCALE_CMF: readonly LevelEntry[] = [
  { id: 5, label: "Muy confiable", minScore: 40 },
  { id: 4, label: "Confiable", minScore: 0 },
  { id: 3, label: "Neutro", minScore: -25 },
  { id: 2, label: "Riesgoso", minScore: -50 },
  { id: 1, label: "Crítico", minScore: FLOOR },
] as const;

/** Escala para sitios que NO requieren regulación CMF (e-commerce, etc.). */
export const SCALE_NO_CMF: readonly LevelEntry[] = [
  { id: 5, label: "Muy confiable", minScore: 15 },
  { id: 4, label: "Confiable", minScore: 5 },
  { id: 3, label: "Neutro", minScore: -10 },
  { id: 2, label: "Riesgoso", minScore: -50 },
  { id: 1, label: "Crítico", minScore: FLOOR },
] as const;

export function scaleFor(profile: ScoreProfile): readonly LevelEntry[] {
  return profile === "cmf" ? SCALE_CMF : SCALE_NO_CMF;
}

/**
 * Determinístico: retorna el primer entry cuyo `minScore <= score`.
 * La escala está ordenada de mayor a menor por construcción, por lo que
 * el primer match es el nivel más alto alcanzable.
 */
export function levelFor(score: number, profile: ScoreProfile): LevelEntry {
  const scale = scaleFor(profile);
  for (const entry of scale) {
    if (score >= entry.minScore) return entry;
  }
  // Inalcanzable: el último entry tiene minScore = FLOOR. El compilador
  // pide return explícito por noUncheckedIndexedAccess.
  /* c8 ignore next */
  throw new Error(`escala mal formada para profile ${profile}`);
}
