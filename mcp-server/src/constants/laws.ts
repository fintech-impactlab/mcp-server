// Catálogo de leyes chilenas relevantes para servicios financieros y datos
// personales. Las entradas están alineadas con el README.md (sección "Marco
// legal y normativo"). Los slugs de BCN para guías ciudadanas viven en
// bcn-ley-slugs.ts; este catálogo es la referencia canónica de identidad.

export interface LawRef {
  /** Identificador estable kebab-case. Cliente puede resolverlo contra slugs BCN. */
  id: string;
  /** Nombre completo + número. */
  nombre: string;
  /** Artículos clave que el cliente debería citar al usuario final. */
  articulosClave: ReadonlyArray<string>;
  /** Fecha de entrada en vigencia (ISO YYYY-MM-DD). */
  vigenciaDesde: string;
  /** Fecha de derogación si aplica; null si está vigente. */
  vigenciaHasta: string | null;
  /** Temas que cubre la ley (informa al cliente al filtrar). */
  tema: ReadonlyArray<string>;
  /** URL pública en BCN al texto vigente. */
  url?: string;
}

export const LAWS: ReadonlyArray<LawRef> = [
  {
    id: "ley-21521",
    nombre: "Ley 21.521 — Promueve la competencia e inclusión financiera (Ley Fintech)",
    articulosClave: ["1", "3", "8", "13", "14", "15", "16"],
    vigenciaDesde: "2023-01-04",
    vigenciaHasta: null,
    tema: ["fintech", "rpsf", "iniciacion_pagos", "asesoria", "crowdfunding", "custodia"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1186436",
  },
  {
    id: "ley-21398",
    nombre: "Ley 21.398 — Protección al consumidor financiero (Ley pro-consumidor)",
    articulosClave: ["1", "2"],
    vigenciaDesde: "2021-12-24",
    vigenciaHasta: null,
    tema: ["consumidor", "credito", "transparencia"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1167984",
  },
  {
    id: "ley-21673",
    nombre: "Ley 21.673 — Modifica Ley 19.496 sobre derechos del consumidor financiero",
    articulosClave: ["1"],
    vigenciaDesde: "2024-04-26",
    vigenciaHasta: null,
    tema: ["consumidor", "transparencia"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1202130",
  },
  {
    id: "ley-21459",
    nombre:
      "Ley 21.459 — Establece normas sobre delitos informáticos y deroga ley 19.223",
    articulosClave: ["1", "2", "5", "7"],
    vigenciaDesde: "2022-06-20",
    vigenciaHasta: null,
    tema: ["delitos_informaticos", "ciberseguridad"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1177743",
  },
  {
    id: "ley-21663",
    nombre: "Ley 21.663 — Marco de Ciberseguridad y crea la ANCI",
    articulosClave: ["1", "8", "27"],
    vigenciaDesde: "2024-04-08",
    vigenciaHasta: null,
    tema: ["ciberseguridad", "incidentes", "anci", "csirt"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1201428",
  },
  {
    id: "ley-21719",
    nombre: "Ley 21.719 — Protección de Datos Personales (PDP, ARCO+)",
    articulosClave: ["1", "4", "11", "14", "16"],
    vigenciaDesde: "2026-12-01",
    vigenciaHasta: null,
    tema: ["datos_personales", "arco", "consentimiento"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1209272",
  },
  {
    id: "ley-19628",
    nombre: "Ley 19.628 — Protección de la Vida Privada",
    articulosClave: ["2", "4", "12", "16"],
    vigenciaDesde: "1999-08-28",
    vigenciaHasta: null,
    tema: ["datos_personales", "privacidad"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=141599",
  },
  {
    id: "ley-20555",
    nombre: "Ley 20.555 — Sernac Financiero",
    articulosClave: ["3", "17B", "17C", "17D"],
    vigenciaDesde: "2012-03-04",
    vigenciaHasta: null,
    tema: ["sernac", "consumidor_financiero", "transparencia"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1035846",
  },
  {
    id: "ley-19496",
    nombre: "Ley 19.496 — Protección de los Derechos del Consumidor",
    articulosClave: ["3", "12", "16", "17B", "17K", "28"],
    vigenciaDesde: "1997-03-07",
    vigenciaHasta: null,
    tema: ["consumidor", "transparencia", "publicidad", "contrato"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=61438",
  },
  {
    id: "ley-18010",
    nombre: "Ley 18.010 — Operaciones de Crédito y Tasa Máxima Convencional",
    articulosClave: ["6", "6 bis", "8", "16", "17"],
    vigenciaDesde: "1981-06-27",
    vigenciaHasta: null,
    tema: ["credito", "tmc", "intereses"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=29438",
  },
  {
    id: "ley-general-bancos",
    nombre: "Ley General de Bancos (DFL Nº 3 de 1997)",
    articulosClave: ["1", "30", "62"],
    vigenciaDesde: "1997-12-19",
    vigenciaHasta: null,
    tema: ["banca", "supervision", "bancos"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=83018",
  },
  {
    id: "ley-general-cooperativas",
    nombre: "Ley General de Cooperativas (DFL Nº 5 de 2003)",
    articulosClave: ["1", "86", "87"],
    vigenciaDesde: "2003-11-17",
    vigenciaHasta: null,
    tema: ["cooperativas", "supervision"],
    url: "https://www.bcn.cl/leychile/navegar?idNorma=215932",
  },
] as const;

export function lawById(id: string): LawRef | undefined {
  return LAWS.find((l) => l.id === id);
}

export function lawsByTopic(topic: string): ReadonlyArray<LawRef> {
  return LAWS.filter((l) => l.tema.includes(topic));
}

/** Devuelve las leyes vigentes en una fecha (ISO YYYY-MM-DD). */
export function lawsInForceAt(date: string): ReadonlyArray<LawRef> {
  return LAWS.filter((l) => {
    const desde = l.vigenciaDesde <= date;
    const hasta = l.vigenciaHasta === null || date <= l.vigenciaHasta;
    return desde && hasta;
  });
}
