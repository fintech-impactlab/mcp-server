// Helpers de mapeo para el orquestador del nuevo motor positivo + cortes.
// Los cortes ahora vienen del engine vía convención de ruleId
// (`cut.down.*` y `cut.up.*`); este archivo conserva solo el mapping
// nivel ↔ verdict legacy y el descriptor humano de cada corte.

import type { Reason } from "../../lib/schemas.js";
import type { LevelId, LevelLabel } from "../../scoring/levels.js";

export type Verdict = "alto_riesgo" | "riesgo_medio" | "sin_senales_negativas";

export interface CutDescriptor {
  reason: string;
  nivel: LevelId;
  etiqueta: LevelLabel;
  ruleId: string;
}

/** Mapping nivel (5) ↔ verdict (3) legacy para retro-compat de clientes. */
export function verdictFromNivel(nivel: LevelId): Verdict {
  if (nivel <= 2) return "alto_riesgo";
  if (nivel === 3) return "riesgo_medio";
  return "sin_senales_negativas";
}

/**
 * Detecta el primer corte en una lista de reasons. La convención de IDs es:
 *   - `cut.down.*` → score=0, nivel=1 (Crítico).
 *   - `cut.up.*`   → score=90, nivel=5 (Muy confiable).
 * `down` tiene prioridad sobre `up` cuando ambos coexisten.
 */
export function cutFromReasons(reasons: ReadonlyArray<Reason>): CutDescriptor | null {
  for (const r of reasons) {
    if (r.ruleId.startsWith("cut.down.")) {
      return {
        reason: r.fundamento || r.message,
        nivel: 1,
        etiqueta: "Crítico",
        ruleId: r.ruleId,
      };
    }
  }
  for (const r of reasons) {
    if (r.ruleId.startsWith("cut.up.")) {
      return {
        reason: r.fundamento || r.message,
        nivel: 5,
        etiqueta: "Muy confiable",
        ruleId: r.ruleId,
      };
    }
  }
  return null;
}
