// Catálogo único de referencias normativas. Estático, sin I/O en runtime.
// Cada entrada con `localPath` debe tener al menos una `Cita` cuyo texto
// aparezca verbatim en el archivo apuntado — validado en `legal-catalog.test.ts`.
//
// Convenciones de id:
//   - CL-LEY-<num>[-art-<n>]                  (ley chilena, opcional artículo)
//   - CL-CT-<art>                              (Código Tributario, artículo)
//   - CMF-<NCG|CIR>-<num>-<año>                (norma CMF)
//   - CMF-MANUAL-<slug> | CMF-RPSF-<slug>      (otros documentos CMF)
//   - CMF-ALERTAS-<slug>                       (snapshot de listados CMF)
//   - SII-<RES|CIR>-<num>-<año>                (norma SII)
//   - EXT-<slug>                               (fuentes no chilenas)

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Cita, LegalReference, LegalRefId } from "./legal-types.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/lib/legal-catalog.js → ../../.. = repo root (mcp-server/dist/lib/ → repo).
const REPO_ROOT = resolve(here, "..", "..", "..");

/** Resolve un `localPath` relativo a la raíz del repo a un path absoluto. */
export function resolveLocalPath(localPath: string): string {
  return resolve(REPO_ROOT, localPath);
}

// localPath relativo a la raíz del repo. Resolverse contra `repoRoot()`.
const NORMS = "data/normativas";
const SII = `${NORMS}/sii`;

const entries: ReadonlyArray<LegalReference> = [
  // ── Leyes (sin localPath; texto verbatim cuando se replique localmente) ──
  {
    id: "CL-LEY-21521",
    kind: "ley",
    titulo: "Ley 21.521 — Promueve la competencia e inclusión financiera (Ley Fintec)",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2023-02-04",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1188983",
    citas: [],
  },
  {
    id: "CL-LEY-21521-art-5",
    kind: "ley",
    titulo:
      "Ley 21.521, Artículo 5 — Registro de Prestadores de Servicios Financieros (RPSF)",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2023-02-04",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1188983",
    citas: [],
  },
  {
    id: "CL-LEY-21521-art-19",
    kind: "ley",
    titulo:
      "Ley 21.521, Artículo 19 — Registro de Prestadores de Servicios Basados en Información",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2023-02-04",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1188983",
    citas: [],
  },
  {
    id: "CL-LEY-21521-art-28",
    kind: "ley",
    titulo:
      "Ley 21.521, Artículo 28 — Conductas indebidas y prohibición de oferta engañosa",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2023-02-04",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1188983",
    citas: [],
  },
  {
    id: "CL-LEY-21398",
    kind: "ley",
    titulo: "Ley 21.398 — Pro-consumidor (modifica Ley 19.496)",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2021-12-24",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1170824",
    citas: [],
  },
  {
    id: "CL-LEY-21673",
    kind: "ley",
    titulo:
      "Ley 21.673 — Establece un sistema de sandbox regulatorio para el mercado financiero",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2024-04-09",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1202037",
    citas: [],
  },
  {
    id: "CL-LEY-21459",
    kind: "ley",
    titulo: "Ley 21.459 — Establece normas sobre delitos informáticos",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2022-06-20",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1177743",
    citas: [],
  },
  {
    id: "CL-LEY-21663",
    kind: "ley",
    titulo: "Ley 21.663 — Marco de Ciberseguridad e Infraestructura Crítica",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2024-04-08",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1201886",
    citas: [],
  },
  {
    id: "CL-LEY-21719",
    kind: "ley",
    titulo: "Ley 21.719 — Protección de datos personales (ARCO+)",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2024-12-13",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1209272",
    citas: [],
  },
  {
    id: "CL-LEY-19496",
    kind: "ley",
    titulo: "Ley 19.496 — Establece normas sobre protección de los derechos de los consumidores",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "1997-03-07",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=61438",
    citas: [],
  },
  {
    id: "CL-LEY-19496-art-17",
    kind: "ley",
    titulo:
      "Ley 19.496, Artículo 17 — Información mínima del proveedor en contratos de adhesión",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "1997-03-07",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=61438",
    citas: [],
  },
  {
    id: "CL-LEY-19496-art-28",
    kind: "ley",
    titulo: "Ley 19.496, Artículo 28 — Publicidad falsa o engañosa",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "1997-03-07",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=61438",
    citas: [],
  },
  {
    id: "CL-LEY-18045",
    kind: "ley",
    titulo: "Ley 18.045 — Mercado de Valores",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "1981-10-22",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=29472",
    citas: [],
  },
  {
    id: "CL-LEY-18045-art-27",
    kind: "ley",
    titulo:
      "Ley 18.045, Artículo 27 — Prohibición de oferta pública de valores no inscritos",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "1981-10-22",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=29472",
    citas: [],
  },
  {
    id: "CL-LEY-18010",
    kind: "ley",
    titulo:
      "Ley 18.010 — Operaciones de crédito de dinero (incluye tasa máxima convencional)",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "1981-06-27",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=29438",
    citas: [],
  },
  {
    id: "CL-CT-66",
    kind: "ley",
    titulo: "Código Tributario, Artículo 66 — Inicio de actividades ante el SII",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "1974-12-31",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=6374",
    citas: [],
  },
  {
    id: "CL-LEY-19628",
    kind: "ley",
    titulo: "Ley 19.628 — Protección de la vida privada y datos personales (texto previo a Ley 21.719)",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "1999-08-28",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=141599",
    citas: [],
  },
  {
    id: "CL-LEY-20555",
    kind: "ley",
    titulo: "Ley 20.555 — SERNAC Financiero (modifica Ley 19.496)",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2012-03-04",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=1035148",
    citas: [],
  },
  {
    id: "CL-LEY-GENERAL-BANCOS",
    kind: "ley",
    titulo: "DFL 3 — Ley General de Bancos",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "1997-12-19",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=83465",
    citas: [],
  },
  {
    id: "CL-LEY-GENERAL-COOPERATIVAS",
    kind: "ley",
    titulo: "DFL 5 — Ley General de Cooperativas",
    autoridad: "Congreso Nacional / BCN",
    vigenciaDesde: "2003-11-17",
    urlOficial: "https://www.bcn.cl/leychile/navegar?idNorma=215486",
    citas: [],
  },

  // ── Normas CMF (con localPath y cita verbatim) ──
  {
    id: "CMF-NCG-502-2024",
    kind: "ncg",
    titulo:
      "NCG 502/2024 — Registro, autorización y obligaciones de los Prestadores de Servicios Financieros (Ley Fintec)",
    autoridad: "CMF",
    vigenciaDesde: "2024-01-12",
    urlOficial: "https://www.cmfchile.cl/normativa/ncg_502_2024.pdf",
    localPath: `${NORMS}/ncg_502_2024.md`,
    citas: [
      {
        articulo:
          "Sección I.A — Solicitud de inscripción en el Registro de Prestadores de Servicios Financieros",
        texto:
          "solicitar la previa inscripción en el Registro de Prestadores de Servicios Financieros",
        ubicacion: {
          localPath: `${NORMS}/ncg_502_2024.md`,
          lineaInicio: 207,
          lineaFin: 207,
        },
      },
    ],
  },
  {
    id: "CMF-NCG-503-2024",
    kind: "ncg",
    titulo:
      "NCG 503/2024 — Exigencias de idoneidad para el desempeño de funciones (asesoría de inversión)",
    autoridad: "CMF",
    vigenciaDesde: "2024-01-12",
    urlOficial: "https://www.cmfchile.cl/normativa/ncg_503_2024.pdf",
    localPath: `${NORMS}/ncg_503_2024.md`,
    citas: [
      {
        articulo: "Sección I — Exigencias de idoneidad",
        texto: "quienes presten el servicio de asesoría de inversión",
        ubicacion: {
          localPath: `${NORMS}/ncg_503_2024.md`,
          lineaInicio: 29,
          lineaFin: 29,
        },
      },
    ],
  },
  {
    id: "CMF-NCG-504-2024",
    kind: "ncg",
    titulo:
      "NCG 504/2024 — Recomendaciones de inversión bajo el inciso tercero del artículo 65 de la Ley 18.045",
    autoridad: "CMF",
    vigenciaDesde: "2024-01-12",
    urlOficial: "https://www.cmfchile.cl/normativa/ncg_504_2024.pdf",
    localPath: `${NORMS}/ncg_504_2024.md`,
    citas: [
      {
        articulo:
          "Disposición general — Obligación de divulgación al recomendar valores",
        texto:
          "todo aquel que entregue recomendaciones para adquirir, mantener o enajenar valores",
        ubicacion: {
          localPath: `${NORMS}/ncg_504_2024.md`,
          lineaInicio: 17,
          lineaFin: 17,
        },
      },
    ],
  },
  {
    id: "CMF-NCG-514-2024",
    kind: "ncg",
    titulo:
      "NCG 514/2024 — Sistema de Finanzas Abiertas (SFA) e inscripción en RPSF/PSBI/PSIP",
    autoridad: "CMF",
    vigenciaDesde: "2024-07-03",
    urlOficial: "https://www.cmfchile.cl/normativa/ncg_514_2024.pdf",
    localPath: `${NORMS}/ncg_514_2024.md`,
    citas: [
      {
        articulo:
          "Sección I.C.1 — Inscripción voluntaria de Prestadores de Servicios Basados en Información (PSBI)",
        texto: "Conforme señala el inciso primero del artículo 19 de la Ley Fintec",
        ubicacion: {
          localPath: `${NORMS}/ncg_514_2024.md`,
          lineaInicio: 318,
          lineaFin: 318,
        },
      },
    ],
  },
  {
    id: "CMF-CIR-2345-2024",
    kind: "circular",
    titulo:
      "Circular 2345/2024 — Cuentas con Provisión de Fondos y Tarjetas Asociadas (MSI bancos)",
    autoridad: "CMF",
    vigenciaDesde: "2024-02-26",
    urlOficial: "https://www.cmfchile.cl/normativa/cir_2345_2024.pdf",
    localPath: `${NORMS}/cir_2345_2024.md`,
    citas: [
      {
        articulo: "Instrucciones — Nuevo archivo Cuentas con Provisión de Fondos",
        texto: "Este nuevo archivo denominado",
        ubicacion: {
          localPath: `${NORMS}/cir_2345_2024.md`,
          lineaInicio: 37,
          lineaFin: 37,
        },
      },
    ],
  },
  {
    id: "CMF-MANUAL-SIF",
    kind: "manual",
    titulo:
      "Manual del Sistema de Información Fintec (SIF) — Tablas y codificaciones",
    autoridad: "CMF",
    vigenciaDesde: "2024-01-01",
    urlOficial: "https://www.cmfchile.cl/normativa/manual_sif.pdf",
    localPath: `${NORMS}/manual_sif_tablas_codificaciones.md`,
    citas: [
      {
        articulo: "Tabla N°1 — Servicios Ley N°21.521",
        texto: "Servicios ley N°21.521",
        ubicacion: {
          localPath: `${NORMS}/manual_sif_tablas_codificaciones.md`,
          lineaInicio: 12,
          lineaFin: 12,
        },
      },
    ],
  },

  // ── Normas SII ──
  {
    id: "SII-RES-036-2021",
    kind: "resolucion",
    titulo:
      "Resolución Exenta SII N°36/2021 — Amplía plazo para presentar DJ Formularios 1947 y 1948",
    autoridad: "SII",
    vigenciaDesde: "2021-03-31",
    urlOficial: "https://www.sii.cl/normativa_legislacion/resoluciones/2021/reso36.pdf",
    localPath: `${SII}/reso_ex_036_2021_criptoactivos_regimen_general.md`,
    citas: [
      {
        articulo: "Materia",
        texto: "AMPLÍA EL PLAZO PARA PRESENTAR LAS",
        ubicacion: {
          localPath: `${SII}/reso_ex_036_2021_criptoactivos_regimen_general.md`,
          lineaInicio: 7,
          lineaFin: 7,
        },
      },
    ],
  },
  {
    id: "SII-RES-113-2025",
    kind: "resolucion",
    titulo:
      "Resolución Exenta SII N°113/2025 — DJ 1963: información sobre activos digitales (no residentes)",
    autoridad: "SII",
    vigenciaDesde: "2025-08-26",
    urlOficial: "https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso113.pdf",
    localPath: `${SII}/reso_ex_113_2025_dj1963_cripto_no_residentes.md`,
    citas: [
      {
        articulo: "Materia — Activos digitales no residentes",
        texto: "ACTIVOS DIGITALES RESPECTO DE",
        ubicacion: {
          localPath: `${SII}/reso_ex_113_2025_dj1963_cripto_no_residentes.md`,
          lineaInicio: 6,
          lineaFin: 6,
        },
      },
    ],
  },
  {
    id: "SII-RES-114-2025",
    kind: "resolucion",
    titulo:
      "Resolución Exenta SII N°114/2025 — DJ 1964: información sobre activos digitales (residentes)",
    autoridad: "SII",
    vigenciaDesde: "2025-08-26",
    urlOficial: "https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso114.pdf",
    localPath: `${SII}/reso_ex_114_2025_dj1964_cripto_residentes.md`,
    citas: [
      {
        articulo: "Materia — Activos digitales residentes",
        texto: "CONTRIBUYENTES CON RESIDENCIA TRIBUTARIA",
        ubicacion: {
          localPath: `${SII}/reso_ex_114_2025_dj1964_cripto_residentes.md`,
          lineaInicio: 8,
          lineaFin: 8,
        },
      },
    ],
  },
  {
    id: "SII-CIR-042-2020",
    kind: "circular",
    titulo:
      "Circular SII N°42/2020 — IVA aplicable a servicios digitales prestados desde el exterior",
    autoridad: "SII",
    vigenciaDesde: "2020-06-11",
    urlOficial: "https://www.sii.cl/normativa_legislacion/circulares/2020/circu42.pdf",
    localPath: `${SII}/circular_042_2020_economia_digital_iva.md`,
    citas: [
      {
        articulo: "Materia",
        texto: "tributación y régimen de administración del Impuesto",
        ubicacion: {
          localPath: `${SII}/circular_042_2020_economia_digital_iva.md`,
          lineaInicio: 10,
          lineaFin: 10,
        },
      },
    ],
  },

  // ── Datasets / snapshots CMF (sin texto local, solo metadatos) ──
  {
    id: "CMF-RPSF-LISTADO",
    kind: "manual",
    titulo:
      "CMF — Registro de Prestadores de Servicios Financieros (RPSF, listado público)",
    autoridad: "CMF",
    vigenciaDesde: "2024-02-03",
    urlOficial:
      "https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65968.html",
    citas: [],
  },
  {
    id: "CMF-ALERTAS-PIF",
    kind: "manual",
    titulo: "CMF — Alertas: Plataformas de Inversión No Reguladas",
    autoridad: "CMF",
    vigenciaDesde: "2020-01-01",
    urlOficial:
      "https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html",
    citas: [],
  },
  {
    id: "CMF-ALERTAS-AC",
    kind: "manual",
    titulo: "CMF — Alertas: Apps de Créditos No Reguladas",
    autoridad: "CMF",
    vigenciaDesde: "2020-01-01",
    urlOficial:
      "https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html",
    citas: [],
  },
  {
    id: "CMF-ALERTAS-CF",
    kind: "manual",
    titulo: "CMF — Alertas: Créditos Fraudulentos",
    autoridad: "CMF",
    vigenciaDesde: "2020-01-01",
    urlOficial:
      "https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html",
    citas: [],
  },
  {
    id: "CMF-ALERTAS-OE",
    kind: "manual",
    titulo: "CMF — Alertas: Otras Entidades No Reguladas",
    autoridad: "CMF",
    vigenciaDesde: "2020-01-01",
    urlOficial:
      "https://www.cmfchile.cl/portal/principal/613/w3-propertyvalue-65845.html",
    citas: [],
  },

  // ── Fuentes externas (TOS / RFC / API) ──
  {
    id: "EXT-PHISHTANK-TOS",
    kind: "tos",
    titulo: "PhishTank — Terms of Service y modelo de verificación comunitaria",
    autoridad: "Cisco Talos",
    vigenciaDesde: "2010-01-01",
    urlOficial: "https://www.phishtank.com/terms_of_use.php",
    citas: [],
  },
  {
    id: "EXT-URLHAUS-TOS",
    kind: "tos",
    titulo: "URLhaus (abuse.ch) — Terms of Service",
    autoridad: "abuse.ch",
    vigenciaDesde: "2018-01-01",
    urlOficial: "https://urlhaus.abuse.ch/api/",
    citas: [],
  },
  {
    id: "EXT-RDAP-RFC-7480",
    kind: "protocolo",
    titulo: "RFC 7480 — HTTP Usage in the Registration Data Access Protocol (RDAP)",
    autoridad: "IETF",
    vigenciaDesde: "2015-03-01",
    urlOficial: "https://datatracker.ietf.org/doc/html/rfc7480",
    citas: [],
  },
  {
    id: "EXT-NIC-CL-POL",
    kind: "tos",
    titulo: "NIC Chile — Reglamentación para el funcionamiento del registro de NIC",
    autoridad: "NIC Chile (Universidad de Chile)",
    vigenciaDesde: "2013-12-01",
    urlOficial: "https://www.nic.cl/normativa/",
    citas: [],
  },
  {
    id: "EXT-BCE-BDE",
    kind: "manual",
    titulo: "Banco Central de Chile — Base de Datos Estadísticos (BDE), tabla de indicadores",
    autoridad: "Banco Central de Chile",
    vigenciaDesde: "2010-01-01",
    urlOficial: "https://si3.bcentral.cl/Bdemovil/BDE/Home",
    citas: [],
  },
  {
    id: "EXT-BCN-LEY-FACIL",
    kind: "manual",
    titulo: "Biblioteca del Congreso Nacional — API Ley Fácil",
    autoridad: "BCN",
    vigenciaDesde: "2015-01-01",
    urlOficial: "https://www.bcn.cl/leyfacil",
    citas: [],
  },
];

export const legalCatalog: ReadonlyMap<LegalRefId, LegalReference> = new Map(
  entries.map((e) => [e.id, e]),
);

export function getLegalReference(id: LegalRefId): LegalReference | undefined {
  return legalCatalog.get(id);
}

export function hasLegalReference(id: LegalRefId): boolean {
  return legalCatalog.has(id);
}

export const _entries: ReadonlyArray<LegalReference> = entries;

export function citasFor(id: LegalRefId): ReadonlyArray<Cita> {
  return legalCatalog.get(id)?.citas ?? [];
}

/**
 * Mapea los IDs internos del catálogo de leyes/normativas
 * (`src/constants/laws.ts`, `src/constants/cmf-norms.ts`) a IDs del catálogo
 * legal único. Devuelve `undefined` si no hay mapping conocido.
 */
const INTERNAL_TO_CATALOG: Readonly<Record<string, LegalRefId>> = {
  // Leyes
  "ley-21521": "CL-LEY-21521",
  "ley-21398": "CL-LEY-21398",
  "ley-21673": "CL-LEY-21673",
  "ley-21459": "CL-LEY-21459",
  "ley-21663": "CL-LEY-21663",
  "ley-21719": "CL-LEY-21719",
  "ley-19628": "CL-LEY-19628",
  "ley-20555": "CL-LEY-20555",
  "ley-19496": "CL-LEY-19496",
  "ley-18045": "CL-LEY-18045",
  "ley-18010": "CL-LEY-18010",
  "ley-general-bancos": "CL-LEY-GENERAL-BANCOS",
  "ley-general-cooperativas": "CL-LEY-GENERAL-COOPERATIVAS",
  // Normativas CMF
  "ncg-502": "CMF-NCG-502-2024",
  "ncg-503": "CMF-NCG-503-2024",
  "ncg-504": "CMF-NCG-504-2024",
  "ncg-514": "CMF-NCG-514-2024",
  "circular-2345": "CMF-CIR-2345-2024",
  "manual-sif": "CMF-MANUAL-SIF",
};

export function catalogIdFromInternal(internalId: string): LegalRefId | undefined {
  return INTERNAL_TO_CATALOG[internalId];
}
