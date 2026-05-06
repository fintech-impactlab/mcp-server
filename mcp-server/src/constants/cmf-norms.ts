// Catálogo canónico de normativas CMF (Normas de Carácter General + Manual SIF
// + Circulares). Es la fuente de verdad para el id/nombre/url de cada norma;
// `cmf-norms-mapping.ts` (Slice 9) consume este catálogo para mapear
// tipoEntidad → normas aplicables.

export interface NormCmfRef {
  /** kebab-case estable (ej. "ncg-502", "manual-sif", "circular-2345"). */
  id: string;
  nombre: string;
  /** Categoría: NCG (norma de carácter general), Manual o Circular. */
  categoria: "ncg" | "manual" | "circular";
  /** Año/versión publicada. */
  publicadoEn: string;
  /** Temas que cubre la norma. */
  tema: ReadonlyArray<string>;
  url?: string;
}

export const CMF_NORMS: ReadonlyArray<NormCmfRef> = [
  {
    id: "ncg-502",
    nombre: "NCG 502 — Plataformas de Financiamiento Colectivo y Sistemas Alternativos",
    categoria: "ncg",
    publicadoEn: "2024",
    tema: ["fintech", "crowdfunding", "rpsf"],
  },
  {
    id: "ncg-503",
    nombre: "NCG 503 — Asesoría de Inversión y Custodia",
    categoria: "ncg",
    publicadoEn: "2024",
    tema: ["fintech", "asesoria", "custodia", "rpsf"],
  },
  {
    id: "ncg-504",
    nombre: "NCG 504 — Iniciación de Pagos y Servicios de Información Financiera",
    categoria: "ncg",
    publicadoEn: "2024",
    tema: ["fintech", "iniciacion_pagos", "rpsf"],
  },
  {
    id: "ncg-514",
    nombre: "NCG 514 — Inscripción en RPSF y Reportes",
    categoria: "ncg",
    publicadoEn: "2024",
    tema: ["fintech", "rpsf", "reportes"],
  },
  {
    id: "manual-sif",
    nombre: "Manual del Sistema de Información Financiera (SIF) — CMF",
    categoria: "manual",
    publicadoEn: "2024",
    tema: ["fintech", "rpsf", "reportes", "supervision"],
  },
  {
    id: "circular-2345",
    nombre: "Circular 2.345 (CMF) — Estándares operacionales",
    categoria: "circular",
    publicadoEn: "2024",
    tema: ["banca", "operacion", "supervision"],
  },
] as const;

export function normById(id: string): NormCmfRef | undefined {
  return CMF_NORMS.find((n) => n.id === id);
}

export function normsByTopic(topic: string): ReadonlyArray<NormCmfRef> {
  return CMF_NORMS.filter((n) => n.tema.includes(topic));
}
