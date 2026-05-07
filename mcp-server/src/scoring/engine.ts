// Motor de scoring puro y determinístico (modelo positivo + cortes).
// Reglas: sin LLM, sin Math.random, sin Date.now (excepto en facts derivados
// del input que se pasan al engine ya calculados). Mismo input → mismo output.

import {
  rules as defaultRules,
  SCORE_CEILING,
  SCORE_FLOOR,
  type Facts,
  type Rule,
} from "./rules.js";

export type Cut = "down" | "up" | null;

export interface ScoreReason {
  ruleId: string;
  weight: number;
  message: string;
  fundamento: string;
  legalRefs?: string[];
}

export interface ScoreResult {
  score: number;
  reasons: ReadonlyArray<ScoreReason>;
  cut: Cut;
}

export interface ScoreOptions {
  /** Conjunto de reglas a evaluar. Default: catálogo completo. */
  rules?: ReadonlyArray<Rule>;
}

function toReason(rule: Rule): ScoreReason {
  const reason: ScoreReason = {
    ruleId: rule.id,
    weight: rule.weight,
    message: rule.reason,
    fundamento: rule.fundamento,
  };
  if (rule.legalRefs !== undefined) {
    reason.legalRefs = [...rule.legalRefs];
  }
  return reason;
}

/**
 * Evalúa los facts contra el catálogo de reglas. Orden de prioridad:
 *   1. cut_down — primer hit fija score=0 y retorna inmediatamente.
 *   2. cut_up   — primer hit fija score=SCORE_CEILING y retorna.
 *   3. gateway + accumulable — suma de pesos, clamp [SCORE_FLOOR, SCORE_CEILING].
 */
export function score(facts: Facts, options: ScoreOptions = {}): ScoreResult {
  const ruleSet = options.rules ?? defaultRules;

  // 1. Cortes hacia abajo (prioridad máxima).
  for (const rule of ruleSet) {
    if (rule.kind === "cut_down" && rule.predicate(facts)) {
      return {
        score: SCORE_FLOOR,
        reasons: [toReason(rule)],
        cut: "down",
      };
    }
  }

  // 2. Cortes hacia arriba.
  for (const rule of ruleSet) {
    if (rule.kind === "cut_up" && rule.predicate(facts)) {
      return {
        score: SCORE_CEILING,
        reasons: [toReason(rule)],
        cut: "up",
      };
    }
  }

  // 3. Acumulación (gateways + accumulables).
  const reasons: ScoreReason[] = [];
  let total = 0;
  for (const rule of ruleSet) {
    if (rule.kind !== "gateway" && rule.kind !== "accumulable") continue;
    if (rule.predicate(facts)) {
      total += rule.weight;
      reasons.push(toReason(rule));
    }
  }
  const clamped = Math.max(SCORE_FLOOR, Math.min(SCORE_CEILING, total));
  return { score: clamped, reasons, cut: null };
}

/** Detecta si una lista de reasons contiene un corte (por convención de ruleId). */
export function detectCutInReasons(
  reasons: ReadonlyArray<{ ruleId: string }>,
): Cut {
  for (const r of reasons) {
    if (r.ruleId.startsWith("cut.down.")) return "down";
  }
  for (const r of reasons) {
    if (r.ruleId.startsWith("cut.up.")) return "up";
  }
  return null;
}

export { SCORE_CEILING, SCORE_FLOOR } from "./rules.js";
