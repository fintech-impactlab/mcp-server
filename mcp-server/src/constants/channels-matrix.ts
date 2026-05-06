// Matriz determinística (situación, tipoEntidad) → canales[] ordenados por
// relevancia (más específico primero). SERNAC siempre disponible al final
// como vía universal para reclamo de consumo.

import type { EntityType } from "../tools/check_regulator_status/classifier.js";
import { Situacion } from "./regulation-matrix.js";

export type { Situacion } from "./regulation-matrix.js";

/** Canales por defecto para cada situación. SERNAC siempre cierra la lista. */
const DEFAULT_FOR_SITUACION: Readonly<Record<Situacion, ReadonlyArray<string>>> = {
  transaccion_no_reconocida: ["cmf-atencion-publico", "denuncia-penal-pdi", "sernac"],
  suplantacion: ["denuncia-penal-pdi", "fiscalia-ministerio-publico", "anci-csirt", "sernac"],
  cargo_abusivo: ["cmf-atencion-publico", "sernac"],
  oferta_inversion_sospechosa: [
    "cmf-atencion-publico",
    "fiscalia-ministerio-publico",
    "denuncia-penal-pdi",
    "sernac",
  ],
  problema_credito: ["cmf-atencion-publico", "sernac"],
  brecha_datos: ["anci-csirt", "spd-ley-21719", "sernac"],
  otro: ["sernac"],
};

/**
 * Overrides por tipo de entidad. Se intercala antes del default cuando el
 * tipo lo requiere (ej. prestamista_no_regulado prioriza fiscalía vs CMF).
 */
const ENTITY_OVERRIDES: Readonly<Partial<Record<EntityType, Partial<Record<Situacion, ReadonlyArray<string>>>>>> = {
  prestamista_no_regulado: {
    cargo_abusivo: ["sernac", "fiscalia-ministerio-publico"],
    problema_credito: ["sernac", "fiscalia-ministerio-publico"],
    transaccion_no_reconocida: ["denuncia-penal-pdi", "fiscalia-ministerio-publico", "sernac"],
  },
  ecommerce_credito: {
    cargo_abusivo: ["sernac", "cmf-atencion-publico"],
    problema_credito: ["sernac"],
  },
  desconocido: {
    oferta_inversion_sospechosa: [
      "fiscalia-ministerio-publico",
      "denuncia-penal-pdi",
      "cmf-atencion-publico",
      "sernac",
    ],
  },
};

export function lookupChannels(
  tipoEntidad: EntityType,
  situacion: Situacion,
): ReadonlyArray<string> {
  const override = ENTITY_OVERRIDES[tipoEntidad]?.[situacion];
  if (override !== undefined) return override;
  return DEFAULT_FOR_SITUACION[situacion];
}
