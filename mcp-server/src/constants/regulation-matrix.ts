// Matriz determinística (situación, tipoEntidad) → leyesAplicables, derechos
// y plazos. Es un catálogo en código (sin LLM, sin random) que cubre las 7
// situaciones del README × 9 tipos de entidad. La ausencia de una situación
// para un tipo cae en `defaultsForSituacion(...)`.

import type { EntityType } from "../tools/check_regulator_status/classifier.js";

export type Situacion =
  | "transaccion_no_reconocida"
  | "suplantacion"
  | "cargo_abusivo"
  | "oferta_inversion_sospechosa"
  | "problema_credito"
  | "brecha_datos"
  | "otro";

export interface Plazo {
  /** Identificador del plazo (ej. "ley-20009-stop-payment-30d"). */
  id: string;
  /** Cantidad de días corridos. */
  dias: number;
  /** Texto explicativo. */
  descripcion: string;
  /** Ley/norma de la que se desprende el plazo. */
  fundamentoLeyId: string;
}

export interface RegulationEntry {
  leyesAplicablesIds: ReadonlyArray<string>;
  normativasCMFIds: ReadonlyArray<string>;
  derechos: ReadonlyArray<string>;
  plazosLegales: ReadonlyArray<Plazo>;
}

const PLAZO_STOP_PAYMENT_30D: Plazo = {
  id: "ley-20009-stop-payment-30d",
  dias: 30,
  descripcion:
    "Plazo para que el emisor reembolse cargos no reconocidos tras notificación del usuario (Ley 20.009 sobre uso fraudulento de tarjetas).",
  fundamentoLeyId: "ley-20009",
};

const PLAZO_RESPUESTA_RECLAMO_30D: Plazo = {
  id: "ley-19496-respuesta-30d",
  dias: 30,
  descripcion:
    "Plazo máximo de respuesta del proveedor a un reclamo formal del consumidor (Ley 19.496 art. 17K).",
  fundamentoLeyId: "ley-19496",
};

const PLAZO_BRECHA_DATOS_72H: Plazo = {
  id: "ley-21663-anci-72h",
  dias: 3,
  descripcion:
    "Notificación obligatoria a la ANCI/CSIRT en caso de incidente de ciberseguridad relevante (Ley 21.663 marco de ciberseguridad).",
  fundamentoLeyId: "ley-21663",
};

const PLAZO_ARCO_30D: Plazo = {
  id: "ley-21719-arco-30d",
  dias: 30,
  descripcion:
    "Plazo para que el responsable atienda una solicitud ARCO+ del titular de datos (Ley 21.719 PDP).",
  fundamentoLeyId: "ley-21719",
};

const DEFAULT_FOR_SITUACION: Readonly<Record<Situacion, RegulationEntry>> = {
  transaccion_no_reconocida: {
    leyesAplicablesIds: ["ley-19496", "ley-21398", "ley-20555", "ley-19628"],
    normativasCMFIds: [],
    derechos: [
      "Derecho a desconocer cargos no reconocidos y exigir reembolso (Ley 20.009).",
      "Derecho a presentar reclamo ante el proveedor con respuesta en plazo legal.",
      "Derecho a recurrir al SERNAC si el proveedor no resuelve.",
    ],
    plazosLegales: [PLAZO_STOP_PAYMENT_30D, PLAZO_RESPUESTA_RECLAMO_30D],
  },
  suplantacion: {
    leyesAplicablesIds: ["ley-21459", "ley-19628", "ley-21719"],
    normativasCMFIds: [],
    derechos: [
      "Derecho a denunciar penalmente la suplantación bajo Ley 21.459 (delitos informáticos).",
      "Derecho a solicitar bloqueo de cuentas afectadas y notificación a CMF.",
      "Derecho a solicitud ARCO+ sobre datos personales mal usados.",
    ],
    plazosLegales: [PLAZO_BRECHA_DATOS_72H, PLAZO_ARCO_30D],
  },
  cargo_abusivo: {
    leyesAplicablesIds: ["ley-19496", "ley-21398", "ley-20555", "ley-18010"],
    normativasCMFIds: [],
    derechos: [
      "Derecho a transparencia y a costo total efectivo (CTE) divulgado.",
      "Derecho a no aceptar tasas que excedan la Tasa Máxima Convencional vigente.",
      "Derecho a reclamar reembolso de cobros indebidos ante SERNAC.",
    ],
    plazosLegales: [PLAZO_RESPUESTA_RECLAMO_30D],
  },
  oferta_inversion_sospechosa: {
    leyesAplicablesIds: ["ley-21521", "ley-19496"],
    normativasCMFIds: ["ncg-502", "ncg-503", "ncg-504", "ncg-514"],
    derechos: [
      "Derecho a verificar que la entidad esté inscrita en el RPSF de la CMF.",
      "Derecho a denunciar oferta pública no registrada ante la CMF.",
      "Derecho a información clara sobre riesgo, plazos y rentabilidad esperada.",
    ],
    plazosLegales: [],
  },
  problema_credito: {
    leyesAplicablesIds: ["ley-18010", "ley-19496", "ley-21398", "ley-20555"],
    normativasCMFIds: [],
    derechos: [
      "Derecho a CTE (costo total efectivo) y a TMC vigente como techo de tasa.",
      "Derecho a refinanciar, renegociar o pagar anticipadamente sin penalizaciones abusivas.",
      "Derecho a información mensual del estado del crédito.",
    ],
    plazosLegales: [PLAZO_RESPUESTA_RECLAMO_30D],
  },
  brecha_datos: {
    leyesAplicablesIds: ["ley-19628", "ley-21719", "ley-21663", "ley-21459"],
    normativasCMFIds: [],
    derechos: [
      "Derecho a ser notificado sobre incidentes que afecten datos personales (Ley 21.719).",
      "Derecho ARCO+ (acceso, rectificación, cancelación, oposición, portabilidad y revocación).",
      "Derecho a denunciar a CSIRT/ANCI cuando hay incidente de ciberseguridad relevante.",
    ],
    plazosLegales: [PLAZO_BRECHA_DATOS_72H, PLAZO_ARCO_30D],
  },
  otro: {
    leyesAplicablesIds: ["ley-19496", "ley-19628"],
    normativasCMFIds: [],
    derechos: [
      "Derechos generales del consumidor (Ley 19.496) y de protección de datos (Ley 19.628).",
    ],
    plazosLegales: [PLAZO_RESPUESTA_RECLAMO_30D],
  },
};

const ENTITY_OVERRIDES: Readonly<Partial<Record<EntityType, Partial<Record<Situacion, RegulationEntry>>>>> = {
  banco: {
    problema_credito: {
      leyesAplicablesIds: ["ley-general-bancos", "ley-18010", "ley-19496", "ley-21398"],
      normativasCMFIds: ["manual-sif", "circular-2345"],
      derechos: DEFAULT_FOR_SITUACION.problema_credito.derechos,
      plazosLegales: DEFAULT_FOR_SITUACION.problema_credito.plazosLegales,
    },
    transaccion_no_reconocida: {
      leyesAplicablesIds: ["ley-general-bancos", "ley-19496", "ley-21398", "ley-20555"],
      normativasCMFIds: ["manual-sif"],
      derechos: DEFAULT_FOR_SITUACION.transaccion_no_reconocida.derechos,
      plazosLegales: DEFAULT_FOR_SITUACION.transaccion_no_reconocida.plazosLegales,
    },
  },
  cooperativa: {
    problema_credito: {
      leyesAplicablesIds: [
        "ley-general-cooperativas",
        "ley-18010",
        "ley-19496",
        "ley-21398",
      ],
      normativasCMFIds: ["ncg-502"],
      derechos: DEFAULT_FOR_SITUACION.problema_credito.derechos,
      plazosLegales: DEFAULT_FOR_SITUACION.problema_credito.plazosLegales,
    },
  },
  fintech: {
    oferta_inversion_sospechosa: {
      leyesAplicablesIds: ["ley-21521", "ley-19496", "ley-21398"],
      normativasCMFIds: ["ncg-502", "ncg-503", "ncg-504", "ncg-514", "manual-sif"],
      derechos: DEFAULT_FOR_SITUACION.oferta_inversion_sospechosa.derechos,
      plazosLegales: DEFAULT_FOR_SITUACION.oferta_inversion_sospechosa.plazosLegales,
    },
  },
};

export function lookupRegulation(
  tipoEntidad: EntityType,
  situacion: Situacion,
): RegulationEntry {
  const override = ENTITY_OVERRIDES[tipoEntidad]?.[situacion];
  if (override !== undefined) return override;
  return DEFAULT_FOR_SITUACION[situacion];
}

export const SITUACIONES: ReadonlyArray<Situacion> = [
  "transaccion_no_reconocida",
  "suplantacion",
  "cargo_abusivo",
  "oferta_inversion_sospechosa",
  "problema_credito",
  "brecha_datos",
  "otro",
];
