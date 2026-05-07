// Tabla declarativa de reglas de scoring (modelo positivo + cortes).
// **Sin LLM, sin random, sin Date.now**. Cada predicate es una función pura.
//
// Modelo:
//   - cut_down: hit fija score=0 y detiene la cadena (CRÍTICO).
//   - cut_up:   hit fija score=90 y detiene la cadena (MUY CONFIABLE).
//   - gateway:  bonus alto (RPSF revisión, FinteChile, banco, AGF). Suma normal.
//   - accumulable: bonus modesto. Suma normal. Score se clampa a [0, 90].
//
// Las "señales negativas" del catálogo previo (SSL inválido, dominio joven,
// SII suspendido, promesas irreales) ya no restan: simplemente no disparan
// la regla positiva equivalente. Los handlers emiten info-reasons para
// trazabilidad pero peso=0.

export type RuleCategory =
  | "blacklist"
  | "whitelist"
  | "domain"
  | "dns"
  | "entity"
  | "regulator"
  | "business_model";

export type RuleKind = "cut_down" | "cut_up" | "gateway" | "accumulable";

export interface DomainFacts {
  ageDays?: number;
  sslIssuer?: string | null;
  sslStatus?: "valid" | "expired" | "self_signed" | "invalid" | "missing";
  redirectCount?: number;
}

export interface BlacklistFacts {
  sources: ReadonlyArray<string>;
}

export interface WhitelistFacts {
  rpsfStatus?: "autorizada" | "en_revision" | "no_registrada";
  fintechileMembership?: boolean;
}

export interface EntityFacts {
  siiStatus?: "activo" | "suspendido" | "sin_inicio";
  ageMonths?: number;
}

export interface DnsFacts {
  registrantCountry?: string | null;
  registrantAnonymized?: boolean;
}

export interface BusinessModelFacts {
  promesaRentabilidadIrreal?: boolean;
  estructuraReferidos?: boolean;
  lenguajeVago?: boolean;
  ausenciaInfoLegal?: boolean;
}

export interface RegulatorFacts {
  tipoEntidad?:
    | "banco"
    | "caja_compensacion"
    | "cooperativa"
    | "fintech"
    | "casa_cambio"
    | "emisor_tarjetas"
    | "ecommerce_credito"
    | "prestamista_no_regulado"
    | "no_fiscalizada"
    | "desconocido";
  estadoRPSF?: "autorizada" | "en_revision" | "no_registrada";
  giroConsistente?: boolean;
  enListaBancos?: boolean;
  enListaAgf?: boolean;
}

export interface Facts {
  domain?: DomainFacts;
  blacklist?: BlacklistFacts;
  whitelist?: WhitelistFacts;
  entity?: EntityFacts;
  dns?: DnsFacts;
  regulator?: RegulatorFacts;
  businessModel?: BusinessModelFacts;
}

export interface Rule {
  readonly id: string;
  readonly category: RuleCategory;
  readonly kind: RuleKind;
  readonly weight: number;
  readonly reason: string;
  readonly fundamento: string;
  readonly legalRefs?: ReadonlyArray<string>;
  readonly predicate: (facts: Facts) => boolean;
}

const CATEGORIES_REQUIRING_LEGAL_REFS = new Set<RuleCategory>([
  "regulator",
  "whitelist",
  "blacklist",
  "entity",
]);

export function ruleHasRequiredLegalRefs(rule: Rule): boolean {
  if (!CATEGORIES_REQUIRING_LEGAL_REFS.has(rule.category)) return true;
  return Array.isArray(rule.legalRefs) && rule.legalRefs.length >= 1;
}

const blacklistHas = (sources: ReadonlyArray<string> | undefined, name: string): boolean =>
  sources !== undefined && sources.includes(name);

export const SCORE_FLOOR = 0;
export const SCORE_CEILING = 90;

const REPUTABLE_CA_TOKENS: ReadonlyArray<string> = [
  "digicert",
  "sectigo",
  "globalsign",
  "entrust",
  "godaddy",
  "amazon",
  "google trust services",
  "microsoft",
  "geotrust",
  "let's encrypt",
];

export const rules: ReadonlyArray<Rule> = [
  // ── CORTES ABAJO (blacklist) — hit fija score=0 ───────────────────────
  {
    id: "cut.down.blacklist.cmf_plataformas_no_reguladas",
    category: "blacklist",
    kind: "cut_down",
    weight: 0,
    reason: "Aparece en CMF — Plataformas de Inversión No Reguladas",
    fundamento:
      "Listado oficial CMF de plataformas que ofrecen inversión sin autorización. Inclusión es banderazo regulatorio explícito.",
    legalRefs: ["CL-LEY-18045-art-27", "CMF-NCG-514-2024", "CMF-ALERTAS-PIF"],
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-plataformas-no-reguladas"),
  },
  {
    id: "cut.down.blacklist.cmf_creditos_fraudulentos",
    category: "blacklist",
    kind: "cut_down",
    weight: 0,
    reason: "Aparece en CMF — Créditos Fraudulentos",
    fundamento:
      "Listado oficial CMF de operadores de crédito fraudulento. Señal regulatoria dura.",
    legalRefs: ["CL-LEY-19496-art-28", "CMF-ALERTAS-CF"],
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-creditos-fraudulentos"),
  },
  {
    id: "cut.down.blacklist.cmf_apps_creditos_no_reguladas",
    category: "blacklist",
    kind: "cut_down",
    weight: 0,
    reason: "Aparece en CMF — Apps de Créditos No Reguladas",
    fundamento:
      "Listado oficial CMF de apps de crédito sin autorización formal.",
    legalRefs: ["CL-LEY-19496-art-28", "CMF-ALERTAS-AC"],
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-apps-creditos-no-reguladas"),
  },
  {
    id: "cut.down.blacklist.cmf_otras_entidades_no_reguladas",
    category: "blacklist",
    kind: "cut_down",
    weight: 0,
    reason: "Aparece en CMF — Otras Entidades No Reguladas",
    fundamento:
      "Listado oficial CMF que captura ofertas financieras fuera del perímetro regulado.",
    legalRefs: ["CL-LEY-21521-art-28", "CMF-ALERTAS-OE"],
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-otras-entidades-no-reguladas"),
  },
  {
    id: "cut.down.blacklist.phishtank",
    category: "blacklist",
    kind: "cut_down",
    weight: 0,
    reason: "URL reportada en PhishTank",
    fundamento: "PhishTank confirma reportes vía verificación comunitaria.",
    legalRefs: ["EXT-PHISHTANK-TOS"],
    predicate: (f) => blacklistHas(f.blacklist?.sources, "phishtank"),
  },
  {
    id: "cut.down.blacklist.urlhaus",
    category: "blacklist",
    kind: "cut_down",
    weight: 0,
    reason: "URL reportada en URLhaus (malware)",
    fundamento: "URLhaus de abuse.ch lista URLs activas asociadas a malware.",
    legalRefs: ["EXT-URLHAUS-TOS"],
    predicate: (f) => blacklistHas(f.blacklist?.sources, "urlhaus"),
  },

  // ── CORTE ARRIBA (whitelist hard) — hit fija score=90 ─────────────────
  {
    id: "cut.up.whitelist.rpsf_autorizada",
    category: "whitelist",
    kind: "cut_up",
    weight: 90,
    reason: "Entidad autorizada en RPSF (Ley 21.521)",
    fundamento:
      "Estado 'autorizada' implica revisión formal CMF aprobada. Es la señal positiva más fuerte y suficiente para máxima confianza.",
    legalRefs: ["CL-LEY-21521-art-5", "CMF-NCG-514-2024", "CMF-RPSF-LISTADO"],
    predicate: (f) => f.whitelist?.rpsfStatus === "autorizada",
  },

  // ── GATEWAYS — bonus alto, permiten seguir acumulando ─────────────────
  {
    id: "gateway.whitelist.rpsf_en_revision",
    category: "whitelist",
    kind: "gateway",
    weight: 30,
    reason: "Solicitud presente en RPSF, en revisión por CMF",
    fundamento:
      "Período transitorio Ley 21.521: la entidad opera legalmente mientras CMF resuelve. Señal positiva intermedia.",
    legalRefs: ["CL-LEY-21521-art-5", "CMF-RPSF-LISTADO"],
    predicate: (f) => f.whitelist?.rpsfStatus === "en_revision",
  },
  {
    id: "gateway.whitelist.fintechile_miembro",
    category: "whitelist",
    kind: "gateway",
    weight: 20,
    reason: "Miembro activo de FinteChile",
    fundamento:
      "Membresía gremial implica escrutinio entre pares; señal positiva intermedia.",
    legalRefs: ["CL-LEY-21521"],
    predicate: (f) => f.whitelist?.fintechileMembership === true,
  },
  {
    id: "gateway.regulator.banco_reconocido",
    category: "regulator",
    kind: "gateway",
    weight: 50,
    reason: "Banco reconocido (Ley General de Bancos)",
    fundamento:
      "La entidad coincide con un banco fiscalizado bajo la Ley General de Bancos. Los bancos no figuran en el RPSF (Ley 21.521); su régimen es la Ley General de Bancos y la supervisión directa de la CMF.",
    legalRefs: ["CL-DFL-3-1997"],
    predicate: (f) => f.regulator?.enListaBancos === true,
  },
  {
    id: "gateway.regulator.agf_reconocida",
    category: "regulator",
    kind: "gateway",
    weight: 50,
    reason: "Administradora General de Fondos / inversión reconocida",
    fundamento:
      "La entidad coincide con una AGF / administradora de inversiones bajo Ley 18.045 / 20.712, fiscalizada por la CMF fuera del RPSF.",
    legalRefs: ["CL-LEY-18045", "CL-LEY-20712"],
    predicate: (f) => f.regulator?.enListaAgf === true,
  },

  // ── ACUMULABLES — regulator/entity ────────────────────────────────────
  {
    id: "acc.regulator.giro_consistente",
    category: "regulator",
    kind: "accumulable",
    weight: 10,
    reason: "Giro tributario consistente con la categoría detectada",
    fundamento:
      "El giro SII coincide con la actividad declarada (ej. fintech con código 6491/6492). Descarta el patrón típico de empresas operando fuera de su giro.",
    legalRefs: ["CL-CT-66"],
    predicate: (f) => f.regulator?.giroConsistente === true,
  },
  {
    id: "acc.entity.sii_activo",
    category: "entity",
    kind: "accumulable",
    weight: 15,
    reason: "Inicio de actividades vigente en el SII",
    fundamento:
      "Status 'activo' confirma que la persona jurídica existe formalmente y opera bajo el sistema tributario chileno.",
    legalRefs: ["CL-CT-66"],
    predicate: (f) => f.entity?.siiStatus === "activo",
  },
  {
    id: "acc.entity.antiguedad_ge_6m",
    category: "entity",
    kind: "accumulable",
    weight: 5,
    reason: "Empresa activa con ≥6 meses desde inicio de actividades",
    fundamento:
      "Antigüedad ≥6m indica historial verificable mínimo en SII; descarta entidades recién creadas. Solo aplica si la entidad está activa en SII.",
    legalRefs: ["CL-CT-66"],
    predicate: (f) => {
      const months = f.entity?.ageMonths;
      return (
        f.entity?.siiStatus === "activo" &&
        typeof months === "number" &&
        months >= 6
      );
    },
  },

  // ── ACUMULABLES — domain ──────────────────────────────────────────────
  {
    id: "acc.domain.age_ge_2y",
    category: "domain",
    kind: "accumulable",
    weight: 10,
    reason: "Dominio con ≥2 años desde su registro",
    fundamento:
      "Antigüedad ≥730 días indica operación sostenida en el tiempo. Incompatible con campañas de fraude de vida media corta.",
    legalRefs: [],
    predicate: (f) => {
      const age = f.domain?.ageDays;
      return typeof age === "number" && age >= 730;
    },
  },
  {
    id: "acc.domain.age_ge_30d",
    category: "domain",
    kind: "accumulable",
    weight: 5,
    reason: "Dominio con ≥30 días desde su registro (<2 años)",
    fundamento:
      "Antigüedad ≥30d filtra dominios recién creados típicos de scams. Excluye ≥2y para evitar doble cómputo.",
    legalRefs: [],
    predicate: (f) => {
      const age = f.domain?.ageDays;
      return typeof age === "number" && age >= 30 && age < 730;
    },
  },
  {
    id: "acc.domain.ssl_valid_reputable",
    category: "domain",
    kind: "accumulable",
    weight: 10,
    reason: "Certificado SSL válido emitido por CA reputada",
    fundamento:
      "Handshake TLS exitoso con cadena válida emitida por CA del top tier (DigiCert, Sectigo, GlobalSign, Google Trust, Amazon, Microsoft, etc.).",
    legalRefs: [],
    predicate: (f) => {
      const status = f.domain?.sslStatus;
      const issuer = f.domain?.sslIssuer;
      if (status !== "valid" || typeof issuer !== "string") return false;
      const lower = issuer.toLowerCase();
      return REPUTABLE_CA_TOKENS.some((t) => lower.includes(t));
    },
  },
  {
    id: "acc.domain.no_redirects",
    category: "domain",
    kind: "accumulable",
    weight: 3,
    reason: "Sin redirecciones HTTP sospechosas (≤3 hops)",
    fundamento:
      "Cadenas largas de redirección entre dominios opacan el destino real. Bajo el umbral de cloaking (≥4 hops) es señal positiva débil.",
    legalRefs: [],
    predicate: (f) => {
      const rc = f.domain?.redirectCount;
      return typeof rc === "number" && rc <= 3;
    },
  },

  // ── ACUMULABLES — dns ─────────────────────────────────────────────────
  {
    id: "acc.dns.registrant_no_anonimo",
    category: "dns",
    kind: "accumulable",
    weight: 5,
    reason: "Registrante WHOIS/RDAP no anonimizado",
    fundamento:
      "Datos de registrante visibles indican transparencia mínima en el registro del dominio.",
    legalRefs: [],
    predicate: (f) => f.dns?.registrantAnonymized === false,
  },
  {
    id: "acc.dns.registrant_pais_chile",
    category: "dns",
    kind: "accumulable",
    weight: 5,
    reason: "Registrante con país declarado CL",
    fundamento:
      "Country=CL en WHOIS/RDAP no garantiza legitimidad pero descarta operadores extranjeros opacos. Compatible con servicio financiero local.",
    legalRefs: ["EXT-NIC-CL-POL"],
    predicate: (f) => f.dns?.registrantCountry === "CL",
  },

  // ── ACUMULABLES — business_model (requieren `text`) ───────────────────
  {
    id: "acc.bm.info_legal_completa",
    category: "business_model",
    kind: "accumulable",
    weight: 5,
    reason: "Sitio publica RUT, razón social y dirección física",
    fundamento:
      "Identificación formal completa según Ley 19.496. Cualquier prestador legítimo en Chile debe identificarse con estos tres datos.",
    legalRefs: ["CL-LEY-19496-art-17"],
    predicate: (f) => f.businessModel?.ausenciaInfoLegal === false,
  },
  {
    id: "acc.bm.sin_promesas_irreales",
    category: "business_model",
    kind: "accumulable",
    weight: 3,
    reason: "Sin promesas de rentabilidad incompatibles con el mercado",
    fundamento:
      "El copy del sitio no contiene promesas de rentabilidad sobre la tasa máxima convencional ni 'riesgo cero'.",
    legalRefs: ["CL-LEY-18010", "CL-LEY-19496-art-28"],
    predicate: (f) => f.businessModel?.promesaRentabilidadIrreal === false,
  },
  {
    id: "acc.bm.sin_referidos",
    category: "business_model",
    kind: "accumulable",
    weight: 3,
    reason: "Sin estructura de ingresos basada en referidos / multinivel",
    fundamento:
      "El modelo de negocio no compensa por reclutamiento; descarta el patrón estructural de esquemas piramidales.",
    legalRefs: ["CL-LEY-19496-art-28"],
    predicate: (f) => f.businessModel?.estructuraReferidos === false,
  },
  {
    id: "acc.bm.lenguaje_tecnico",
    category: "business_model",
    kind: "accumulable",
    weight: 2,
    reason: "Comunicación con lenguaje técnico apropiado",
    fundamento:
      "Sin tokens de urgencia artificial ('cupos limitados', 'oportunidad única'); descarta el patrón de marketing fraudulento.",
    legalRefs: [],
    predicate: (f) => f.businessModel?.lenguajeVago === false,
  },
] as const;
