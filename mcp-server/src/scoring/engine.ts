// Motor de scoring puro y determinístico.
// Reglas: sin LLM, sin Math.random, sin Date.now (excepto en facts derivados
// del input que se pasan al engine ya calculados). Mismo input → mismo output.

import { rules as defaultRules, type Facts, type Rule } from "./rules.js";

export type ScoreProfile = "cmf" | "no_cmf";

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
}

export interface ScoreOptions {
  /**
   * Perfil de scoring. `"cmf"` aplica las 28 reglas; `"no_cmf"` ignora las
   * 11 reglas marcadas con `appliesToNonCmf=false` (listados CMF, RPSF,
   * promesas de rentabilidad — no aplican a sitios fuera del perímetro
   * regulatorio CMF). Default: `"cmf"`.
   */
  profile?: ScoreProfile;
  /**
   * Conjunto de reglas a evaluar. Default: catálogo completo de `rules.ts`.
   * Útil para tests con reglas inyectadas.
   */
  rules?: ReadonlyArray<Rule>;
}

export function score(facts: Facts, options: ScoreOptions = {}): ScoreResult {
  const profile: ScoreProfile = options.profile ?? "cmf";
  const ruleSet = options.rules ?? defaultRules;
  const reasons: ScoreReason[] = [];
  let total = 0;
  for (const rule of ruleSet) {
    if (profile === "no_cmf" && rule.appliesToNonCmf === false) continue;
    if (rule.predicate(facts)) {
      total += rule.weight;
      const reason: ScoreReason = {
        ruleId: rule.id,
        weight: rule.weight,
        message: rule.reason,
        fundamento: rule.fundamento,
      };
      if (rule.legalRefs !== undefined) {
        reason.legalRefs = [...rule.legalRefs];
      }
      reasons.push(reason);
    }
  }
  return { score: total, reasons };
}
