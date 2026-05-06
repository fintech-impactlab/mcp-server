// Mapping tipoEntidad → normativas/leyes aplicables (CMF chilena).
//
// Fuente: README.md sección "Etapa 4 - Marco Legal" + plan-tools.md Slice 9.2.
// Los IDs de leyes y NCG se mantienen en kebab-case estable; el cliente puede
// resolverlos contra el catálogo de Slice 11 (`get_applicable_regulation`).

import type { EntityType } from "../tools/check_regulator_status/classifier.js";

export interface NormaRef {
  id: string;
  nombre: string;
  url?: string;
}

const LEY_GENERAL_BANCOS: NormaRef = {
  id: "ley-general-bancos",
  nombre: "Ley General de Bancos (DFL Nº 3 de 1997)",
  url: "https://www.bcn.cl/leychile/navegar?idNorma=83018",
};

const LEY_21521: NormaRef = {
  id: "ley-21521",
  nombre: "Ley 21.521 (Fintech) — Regulación de Servicios Financieros Tecnológicos",
  url: "https://www.bcn.cl/leychile/navegar?idNorma=1186436",
};

const LEY_18010: NormaRef = {
  id: "ley-18010",
  nombre: "Ley 18.010 — Operaciones de Crédito y Tasa Máxima Convencional",
  url: "https://www.bcn.cl/leychile/navegar?idNorma=29438",
};

const LEY_19496: NormaRef = {
  id: "ley-19496",
  nombre: "Ley 19.496 — Protección de los Derechos del Consumidor",
  url: "https://www.bcn.cl/leychile/navegar?idNorma=61438",
};

const LEY_19628: NormaRef = {
  id: "ley-19628",
  nombre: "Ley 19.628 — Protección de la Vida Privada (datos personales)",
  url: "https://www.bcn.cl/leychile/navegar?idNorma=141599",
};

const LEY_GENERAL_COOPERATIVAS: NormaRef = {
  id: "ley-general-cooperativas",
  nombre: "Ley General de Cooperativas (DFL Nº 5 de 2003)",
  url: "https://www.bcn.cl/leychile/navegar?idNorma=215932",
};

const NCG_502: NormaRef = {
  id: "ncg-502",
  nombre: "NCG 502 — Plataformas de Financiamiento Colectivo y Sistemas Alternativos",
};

const NCG_503: NormaRef = {
  id: "ncg-503",
  nombre: "NCG 503 — Asesoría de Inversión y Custodia",
};

const NCG_504: NormaRef = {
  id: "ncg-504",
  nombre: "NCG 504 — Iniciación de Pagos y Servicios de Información Financiera",
};

const NCG_514: NormaRef = {
  id: "ncg-514",
  nombre: "NCG 514 — Inscripción en RPSF y Reportes",
};

const MANUAL_SIF: NormaRef = {
  id: "manual-sif",
  nombre: "Manual del Sistema de Información Financiera (SIF) — CMF",
};

const CIR_2345: NormaRef = {
  id: "circular-2345",
  nombre: "Circular 2.345 (CMF) — Estándares operacionales",
};

export const CMF_NORMS_MAPPING: Readonly<Record<EntityType, ReadonlyArray<NormaRef>>> = {
  banco: [LEY_GENERAL_BANCOS, MANUAL_SIF, CIR_2345, LEY_18010, LEY_19496, LEY_19628],
  caja_compensacion: [LEY_18010, LEY_19496, LEY_19628],
  cooperativa: [LEY_GENERAL_COOPERATIVAS, NCG_502, LEY_18010, LEY_19496, LEY_19628],
  fintech: [LEY_21521, NCG_502, NCG_503, NCG_504, NCG_514, MANUAL_SIF, LEY_19628],
  casa_cambio: [LEY_21521, NCG_504, LEY_19496, LEY_19628],
  emisor_tarjetas: [NCG_502, MANUAL_SIF, LEY_18010, LEY_19496, LEY_19628],
  ecommerce_credito: [LEY_19496, LEY_19628, LEY_18010],
  prestamista_no_regulado: [LEY_18010, LEY_19496, LEY_19628],
  desconocido: [LEY_19496, LEY_19628],
};

export function normsFor(type: EntityType): ReadonlyArray<NormaRef> {
  return CMF_NORMS_MAPPING[type];
}
