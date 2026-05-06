// Motor de scoring puro y determinístico.
// Reglas: sin LLM, sin Math.random, sin Date.now (excepto en facts derivados
// del input que se pasan al engine ya calculados). Mismo input → mismo output.

import { rules as defaultRules, type Facts, type Rule } from "./rules.js";

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

export function score(
  facts: Facts,
  rules: ReadonlyArray<Rule> = defaultRules,
): ScoreResult {
  const reasons: ScoreReason[] = [];
  let total = 0;
  for (const rule of rules) {
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
