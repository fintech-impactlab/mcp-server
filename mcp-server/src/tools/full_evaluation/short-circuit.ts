// Reglas determinísticas de corte temprano para el orquestador. Se aplican
// después de cada etapa para decidir si vale la pena seguir. No reciben Facts
// crudos; reciben las salidas reales de las tools de cada etapa.

import type { Output as BlacklistOutput } from "../check_blacklist/schema.js";
import type { Output as DomainOutput } from "../analyze_domain/schema.js";
import type { Output as RegulatorOutput } from "../check_regulator_status/schema.js";

export type Verdict = "alto_riesgo" | "riesgo_medio" | "sin_senales_negativas";

export interface ShortCircuit {
  reason: string;
  verdict: Verdict;
}

/**
 * Corta tras Etapa 1 si la blacklist tiene ≥2 hits con weight ≤ -40.
 * Los pesos se evalúan a partir de las reasons agregadas por el handler.
 */
export function shortCircuitAfterStage1(
  blacklist: BlacklistOutput | null,
): ShortCircuit | null {
  if (blacklist === null) return null;
  const heavyHits = blacklist.reasons.filter((r) => r.weight <= -40).length;
  if (heavyHits >= 2) {
    return {
      reason: `${heavyHits} fuentes de blacklist con peso ≤ -40 confirman alto riesgo; no se requiere análisis adicional.`,
      verdict: "alto_riesgo",
    };
  }
  return null;
}

/**
 * Corta tras Etapa 3 con verdict positivo si la entidad está autorizada en
 * RPSF Y el dominio tiene >2 años Y el SSL viene de una CA reputada.
 */
export function shortCircuitAfterStage3(
  regulator: RegulatorOutput | null,
  domain: DomainOutput | null,
): ShortCircuit | null {
  if (regulator === null || domain === null) return null;
  if (regulator.estadoRPSF !== "autorizada") return null;
  const ageDays = domain.domainAgeDays;
  if (ageDays === null || ageDays < 730) return null;
  if (domain.sslStatus !== "valid") return null;
  if (domain.sslIssuer === null) return null;
  if (issuerIsReputable(domain.sslIssuer)) {
    return {
      reason:
        "Entidad autorizada en RPSF + dominio con más de 2 años + SSL válido emitido por CA reputada: indicadores convergentes positivos.",
      verdict: "sin_senales_negativas",
    };
  }
  return null;
}

const REPUTABLE_ISSUERS: ReadonlyArray<string> = [
  "DigiCert",
  "Sectigo",
  "GlobalSign",
  "Entrust",
  "GoDaddy",
  "Amazon",
  "Google Trust Services",
  "Microsoft",
  "GeoTrust",
];

function issuerIsReputable(issuer: string): boolean {
  const lower = issuer.toLowerCase();
  return REPUTABLE_ISSUERS.some((r) => lower.includes(r.toLowerCase()));
}
