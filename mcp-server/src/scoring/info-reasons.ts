// Helper para construir Reason con kind="info" — razones informativas que
// las tools emiten cuando una fuente respondió OK pero ninguna regla del
// engine matcheó. Auditables igual que las signal reasons pero no afectan
// el score (weight siempre 0).
//
// Convención `ruleId`: "info.<toolName>.<aspect>" — kebab-case para aspect.

import type { Reason } from "../lib/schemas.js";

export interface InfoReasonOptions {
  /** Texto explicativo del por qué se emitió esta info reason. Default: el message. */
  fundamento?: string;
  /** IDs del catálogo legal que sustentan la verificación. */
  legalRefs?: ReadonlyArray<string>;
}

/**
 * Construye una Reason informativa.
 *
 * @example
 *   infoReason("check_blacklist", "cmf_alertas_no_match",
 *     "Sin coincidencias en CMF Alertas Ciudadanas",
 *     {
 *       fundamento: "Se consultaron los 4 listados oficiales. El input no figura.",
 *       legalRefs: ["CMF-ALERTAS-PIF"],
 *     })
 */
export function infoReason(
  toolName: string,
  aspect: string,
  message: string,
  opts: InfoReasonOptions = {},
): Reason {
  const reason: Reason = {
    ruleId: `info.${toolName}.${aspect}`,
    weight: 0,
    message,
    fundamento: opts.fundamento ?? message,
    kind: "info",
  };
  if (opts.legalRefs !== undefined && opts.legalRefs.length > 0) {
    reason.legalRefs = [...opts.legalRefs];
  }
  return reason;
}
