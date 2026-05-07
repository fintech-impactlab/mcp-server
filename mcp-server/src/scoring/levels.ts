// Escala única de niveles de confianza (semáforo de 5 estados).
// Se elimina la dualidad CMF / No-CMF: una sola escala con cortes binarios
// arriba (90 = Muy confiable) y abajo (0 = Crítico).

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
  readonly minScore: number;
}

const FLOOR = -9999;

export const SCALE: readonly LevelEntry[] = [
  { id: 5, label: "Muy confiable", minScore: 90 },
  { id: 4, label: "Confiable", minScore: 60 },
  { id: 3, label: "Neutro", minScore: 30 },
  { id: 2, label: "Riesgoso", minScore: 1 },
  { id: 1, label: "Crítico", minScore: FLOOR },
] as const;

/**
 * Determinístico: retorna el primer entry cuyo `minScore <= score`.
 * La escala está ordenada de mayor a menor por construcción.
 */
export function levelFor(score: number): LevelEntry {
  for (const entry of SCALE) {
    if (score >= entry.minScore) return entry;
  }
  /* c8 ignore next */
  throw new Error("escala mal formada");
}
