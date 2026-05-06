// Tabla declarativa de reglas de scoring. **Sin LLM, sin random, sin Date.now**.
// Cada predicate es una función pura sobre Facts. Cada peso (weight) tiene su
// fundamento documentado y entra acotado en [-70, +50] (cota expandida en
// T1.2 para acomodar las penalizaciones más fuertes del simulador
// `scoring_extension_chrome_v3.xlsx`).
//
// Cada regla declara `appliesToNonCmf`: cuando una evaluación se ejecuta
// bajo perfil "no_cmf" (sitio que no debería estar regulado por la CMF —
// ej. e-commerce, supermercado), las reglas con `appliesToNonCmf=false`
// se ignoran. Las 11 reglas CMF-only son las 4 blacklists CMF, las 2
// regulator, las 3 whitelist y 2 business_model (promesa rentabilidad
// irreal y estructura referidos).

export type RuleCategory =
  | "blacklist"
  | "whitelist"
  | "domain"
  | "dns"
  | "entity"
  | "regulator"
  | "business_model";

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
  readonly weight: number;
  readonly reason: string;
  readonly fundamento: string;
  /**
   * IDs del catálogo legal (`mcp-server/src/lib/legal-catalog.ts`) que
   * sustentan esta regla. Obligatorio para `regulator|whitelist|blacklist|entity`.
   * Vacío para señales técnicas sin base normativa directa (`domain|dns`)
   * y heurísticas (`business_model.lenguaje_vago`).
   */
  readonly legalRefs?: ReadonlyArray<string>;
  /**
   * `true` cuando la regla aplica también a sitios que NO deberían estar
   * regulados por la CMF (señales generales: phishing, SSL, dominio joven,
   * SII). `false` para reglas CMF-only (listados oficiales CMF, RPSF,
   * promesas de rentabilidad). Refleja la columna "Aplica a no-CMF" del
   * simulador `scoring_extension_chrome_v3.xlsx`.
   */
  readonly appliesToNonCmf: boolean;
  readonly predicate: (facts: Facts) => boolean;
}

const CATEGORIES_REQUIRING_LEGAL_REFS = new Set<RuleCategory>([
  "regulator",
  "whitelist",
  "blacklist",
  "entity",
]);

/** True si la regla cumple el contrato de citación según su categoría. */
export function ruleHasRequiredLegalRefs(rule: Rule): boolean {
  if (!CATEGORIES_REQUIRING_LEGAL_REFS.has(rule.category)) return true;
  return Array.isArray(rule.legalRefs) && rule.legalRefs.length >= 1;
}

const blacklistHas = (sources: ReadonlyArray<string> | undefined, name: string): boolean =>
  sources !== undefined && sources.includes(name);

export const rules: ReadonlyArray<Rule> = [
  // ── Domain ─────────────────────────────────────────────────────────────
  {
    id: "domain.young_lt7d",
    category: "domain",
    weight: -40,
    reason: "Dominio registrado hace menos de 7 días",
    fundamento:
      "Dominios <7d correlacionan fuertemente con campañas activas de phishing/scam; vida media de un dominio fraudulento es típicamente <30d.",
    legalRefs: [],
    appliesToNonCmf: true,
    predicate: (f) => {
      const age = f.domain?.ageDays;
      return typeof age === "number" && age < 7;
    },
  },
  {
    id: "domain.young_lt30d",
    category: "domain",
    weight: -25,
    reason: "Dominio registrado hace menos de 30 días (≥7)",
    fundamento:
      "Dominios <30d son incompatibles con un negocio financiero establecido. Excluye <7d (regla anterior) para evitar doble cómputo.",
    legalRefs: [],
    appliesToNonCmf: true,
    predicate: (f) => {
      const age = f.domain?.ageDays;
      return typeof age === "number" && age >= 7 && age < 30;
    },
  },
  {
    id: "domain.ssl_lets_encrypt_recent",
    category: "domain",
    weight: -10,
    reason: "Certificado SSL emitido por Let's Encrypt sobre dominio reciente",
    fundamento:
      "Let's Encrypt es legítimo, pero su disponibilidad gratuita + automatizada hace que la mayoría de scams emitan SSL ahí. Combinado con dominio <90d es señal débil pero notoria.",
    legalRefs: [],
    appliesToNonCmf: true,
    predicate: (f) => {
      const age = f.domain?.ageDays;
      const issuer = f.domain?.sslIssuer;
      return (
        typeof age === "number" &&
        age < 90 &&
        typeof issuer === "string" &&
        issuer.toLowerCase().includes("let's encrypt")
      );
    },
  },
  {
    id: "domain.ssl_self_signed",
    category: "domain",
    weight: -30,
    reason: "Certificado SSL autofirmado",
    fundamento:
      "Un sitio que pide datos personales con SSL autofirmado no pasa la verificación de cadena de confianza; típico de servidores improvisados o intencionalmente opacos.",
    legalRefs: [],
    appliesToNonCmf: true,
    predicate: (f) => f.domain?.sslStatus === "self_signed",
  },
  {
    id: "domain.ssl_invalid",
    category: "domain",
    weight: -40,
    reason: "Certificado SSL inválido o expirado",
    fundamento:
      "SSL inválido o vencido invalida cualquier promesa de seguridad de transporte y suele indicar abandono operacional o fraude descuidado.",
    legalRefs: [],
    appliesToNonCmf: true,
    predicate: (f) =>
      f.domain?.sslStatus === "invalid" || f.domain?.sslStatus === "expired",
  },
  {
    id: "domain.ssl_missing",
    category: "domain",
    weight: -40,
    reason: "Sitio sin certificado SSL",
    fundamento:
      "Cualquier sitio que reciba RUT/credenciales sin TLS no es viable como contraparte financiera, ni siquiera en 2026.",
    legalRefs: [],
    appliesToNonCmf: true,
    predicate: (f) => f.domain?.sslStatus === "missing",
  },
  {
    id: "domain.too_many_redirects",
    category: "domain",
    weight: -15,
    reason: "Cadena de redirecciones >3 hops",
    fundamento:
      "Cadenas largas de redirección entre dominios opacan el destino real y son típicas de campañas de scam que lavan tráfico via cloaking. ≥4 hops es señal débil pero notoria.",
    legalRefs: [],
    appliesToNonCmf: true,
    predicate: (f) => {
      const rc = f.domain?.redirectCount;
      return typeof rc === "number" && rc >= 4;
    },
  },

  // ── Blacklist ──────────────────────────────────────────────────────────
  {
    id: "blacklist.cmf_plataformas_no_reguladas",
    category: "blacklist",
    weight: -50,
    reason: "Aparece en CMF — Plataformas de Inversión No Reguladas",
    fundamento:
      "La CMF publica este listado tras detectar oferta pública de inversión sin autorización. Inclusión = banderazo regulatorio chileno explícito.",
    legalRefs: ["CL-LEY-18045-art-27", "CMF-NCG-514-2024", "CMF-ALERTAS-PIF"],
    appliesToNonCmf: false,
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-plataformas-no-reguladas"),
  },
  {
    id: "blacklist.cmf_creditos_fraudulentos",
    category: "blacklist",
    weight: -50,
    reason: "Aparece en CMF — Créditos Fraudulentos",
    fundamento:
      "Listado oficial CMF de operadores de crédito fraudulento. Inclusión es señal regulatoria dura.",
    legalRefs: ["CL-LEY-19496-art-28", "CMF-ALERTAS-CF"],
    appliesToNonCmf: false,
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-creditos-fraudulentos"),
  },
  {
    id: "blacklist.phishtank",
    category: "blacklist",
    weight: -40,
    reason: "URL reportada en PhishTank",
    fundamento:
      "PhishTank confirma reportes vía verificación comunitaria. False positives son raros en URLs verified.",
    legalRefs: ["EXT-PHISHTANK-TOS"],
    appliesToNonCmf: true,
    predicate: (f) => blacklistHas(f.blacklist?.sources, "phishtank"),
  },
  {
    id: "blacklist.cmf_apps_creditos_no_reguladas",
    category: "blacklist",
    weight: -50,
    reason: "Aparece en CMF — Apps de Créditos No Reguladas",
    fundamento:
      "Listado oficial CMF de apps de crédito sin autorización formal. Misma fuerza señalética que Plataformas / Créditos Fraudulentos.",
    legalRefs: ["CL-LEY-19496-art-28", "CMF-ALERTAS-AC"],
    appliesToNonCmf: false,
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-apps-creditos-no-reguladas"),
  },
  {
    id: "blacklist.cmf_otras_entidades_no_reguladas",
    category: "blacklist",
    weight: -50,
    reason: "Aparece en CMF — Otras Entidades No Reguladas",
    fundamento:
      "Listado oficial CMF que captura ofertas financieras fuera del perímetro regulado que no encajan en los otros 3 listados.",
    legalRefs: ["CL-LEY-21521-art-28", "CMF-ALERTAS-OE"],
    appliesToNonCmf: false,
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-otras-entidades-no-reguladas"),
  },
  {
    id: "blacklist.urlhaus",
    category: "blacklist",
    weight: -30,
    reason: "URL reportada en URLhaus",
    fundamento:
      "URLhaus de abuse.ch lista URLs activas asociadas a malware. Hit confirma intencionalidad maliciosa, peso menor que listados regulatorios chilenos pero suma.",
    legalRefs: ["EXT-URLHAUS-TOS"],
    appliesToNonCmf: true,
    predicate: (f) => blacklistHas(f.blacklist?.sources, "urlhaus"),
  },

  // ── Whitelist ──────────────────────────────────────────────────────────
  {
    id: "whitelist.rpsf_autorizada",
    category: "whitelist",
    weight: 30,
    reason: "Entidad autorizada en RPSF (Registro de Prestadores de Servicios Financieros)",
    fundamento:
      "Estado 'autorizada' bajo Ley 21.521 implica revisión formal CMF aprobada. Es la señal positiva más fuerte de la lista de la CMF.",
    legalRefs: ["CL-LEY-21521-art-5", "CMF-NCG-514-2024", "CMF-RPSF-LISTADO"],
    appliesToNonCmf: false,
    predicate: (f) => f.whitelist?.rpsfStatus === "autorizada",
  },
  {
    id: "whitelist.rpsf_en_revision",
    category: "whitelist",
    weight: 10,
    reason: "Solicitud presente en RPSF, en revisión por CMF",
    fundamento:
      "Período transitorio Ley 21.521: la entidad opera legalmente mientras CMF resuelve. No es garantía pero es señal positiva intermedia (179 autorizadas + 300 en revisión a feb 2025).",
    legalRefs: ["CL-LEY-21521-art-5", "CMF-RPSF-LISTADO"],
    appliesToNonCmf: false,
    predicate: (f) => f.whitelist?.rpsfStatus === "en_revision",
  },
  {
    id: "whitelist.fintechile_miembro",
    category: "whitelist",
    weight: 15,
    reason: "Miembro activo de FinteChile",
    fundamento:
      "Membresía gremial implica al menos un nivel mínimo de escrutinio entre pares; señal positiva intermedia mientras la Ley Fintech termina de implementarse.",
    legalRefs: ["CL-LEY-21521"],
    appliesToNonCmf: false,
    predicate: (f) => f.whitelist?.fintechileMembership === true,
  },

  // ── DNS ────────────────────────────────────────────────────────────────
  {
    id: "dns.registrant_pais_chile",
    category: "dns",
    weight: 5,
    reason: "Registrante público con país declarado CL",
    fundamento:
      "Que el registrante tenga país CL en WHOIS/RDAP no garantiza legitimidad pero descarta operadores extranjeros opacos; señal positiva débil compatible con un servicio financiero local.",
    legalRefs: ["EXT-NIC-CL-POL"],
    appliesToNonCmf: true,
    predicate: (f) => f.dns?.registrantCountry === "CL",
  },
  {
    id: "dns.registrant_anonimo",
    category: "dns",
    weight: -15,
    reason: "Registrante WHOIS/RDAP anonimizado vía privacy proxy",
    fundamento:
      "Privacidad proxy es legítima en general, pero un proveedor financiero serio publica datos verificables del registrante. Anonimato + servicio financiero = bandera de opacidad.",
    legalRefs: [],
    appliesToNonCmf: true,
    predicate: (f) => f.dns?.registrantAnonymized === true,
  },

  // ── Entity (SII) ───────────────────────────────────────────────────────
  {
    id: "entity.sii_activo",
    category: "entity",
    weight: 10,
    reason: "Inicio de actividades vigente en el SII",
    fundamento:
      "Status 'activo' confirma que la persona jurídica existe formalmente y opera bajo el sistema tributario chileno. Necesario, no suficiente.",
    legalRefs: ["CL-CT-66"],
    appliesToNonCmf: true,
    predicate: (f) => f.entity?.siiStatus === "activo",
  },
  {
    id: "entity.sii_suspendido",
    category: "entity",
    weight: -30,
    reason: "Estado 'suspendido' en el SII",
    fundamento:
      "Suspensión SII es señal regulatoria dura: la entidad no debería estar realizando operaciones con público mientras esté en ese estado.",
    legalRefs: ["CL-CT-66"],
    appliesToNonCmf: true,
    predicate: (f) => f.entity?.siiStatus === "suspendido",
  },
  {
    id: "entity.sii_sin_inicio",
    category: "entity",
    weight: -50,
    reason: "Sin inicio de actividades en el SII",
    fundamento:
      "Si una empresa que ofrece servicios financieros no figura con inicio de actividades, no existe formalmente en el sistema tributario chileno; es prácticamente concluyente.",
    legalRefs: ["CL-CT-66"],
    appliesToNonCmf: true,
    predicate: (f) => f.entity?.siiStatus === "sin_inicio",
  },
  // ── Business Model ─────────────────────────────────────────────────────
  {
    id: "bm.promesa_rentabilidad_irreal",
    category: "business_model",
    weight: -30,
    reason: "Promesas de rentabilidad incompatibles con el mercado regulado",
    fundamento:
      "Una rentabilidad anualizada que excede la tasa máxima convencional o promete riesgo cero es contradictoria con el funcionamiento del mercado financiero chileno; señal regulatoria dura cuando se detecta en oferta pública.",
    legalRefs: ["CL-LEY-18010", "CL-LEY-19496-art-28"],
    appliesToNonCmf: false,
    predicate: (f) => f.businessModel?.promesaRentabilidadIrreal === true,
  },
  {
    id: "bm.estructura_referidos",
    category: "business_model",
    weight: -25,
    reason: "Modelo de ingresos basado en referidos / multinivel",
    fundamento:
      "La compensación por reclutamiento (en lugar de venta de servicios) es el patrón estructural de esquemas piramidales; bajo ley chilena (Ley 19.496 + jurisprudencia CMF) es indicio de fraude.",
    legalRefs: ["CL-LEY-19496-art-28"],
    appliesToNonCmf: false,
    predicate: (f) => f.businessModel?.estructuraReferidos === true,
  },
  {
    id: "bm.lenguaje_vago",
    category: "business_model",
    weight: -10,
    reason: "Comunicación con lenguaje aspiracional vago, urgencia artificial",
    fundamento:
      "'Oportunidad única', 'cupos limitados', 'libertad financiera' son tokens recurrentes en marketing fraudulento porque buscan compresión temporal de la decisión y desactivan el escrutinio del usuario.",
    legalRefs: [],
    appliesToNonCmf: true,
    predicate: (f) => f.businessModel?.lenguajeVago === true,
  },
  {
    id: "bm.ausencia_info_legal",
    category: "business_model",
    weight: -15,
    reason: "Sitio sin RUT, razón social ni dirección física",
    fundamento:
      "Cualquier prestador de servicios financieros en Chile debe identificarse formalmente. Ausencia simultánea de RUT + razón social + dirección física es incompatible con un negocio financiero legítimo (Ley 19.496 art. 28).",
    legalRefs: ["CL-LEY-19496-art-17"],
    appliesToNonCmf: true,
    predicate: (f) => f.businessModel?.ausenciaInfoLegal === true,
  },

  // ── Regulator ──────────────────────────────────────────────────────────
  {
    id: "regulator.rpsf_autorizada_y_giro_consistente",
    category: "regulator",
    weight: 25,
    reason: "Autorizada en RPSF con giro tributario consistente con la categoría",
    fundamento:
      "RPSF autorizada + giro SII coherente con la actividad declarada (ej. fintech con código 6491/6492 o asesor con 6499) descarta el patrón típico de empresas autorizadas pero operando fuera de su giro.",
    legalRefs: ["CL-LEY-21521-art-5", "CL-CT-66", "CMF-NCG-514-2024"],
    appliesToNonCmf: false,
    predicate: (f) =>
      f.regulator?.estadoRPSF === "autorizada" && f.regulator?.giroConsistente === true,
  },
  {
    id: "regulator.fintech_no_registrada",
    category: "regulator",
    weight: -30,
    reason: "Operación que se presenta como fintech sin estar inscrita en RPSF",
    fundamento:
      "Bajo Ley 21.521 todo prestador de servicios fintech debe registrarse en RPSF (Plataformas, Custodios, Asesores, Iniciadores, Enrutadores). Operar como fintech sin registro es directamente irregular.",
    legalRefs: ["CL-LEY-21521-art-5", "CMF-NCG-514-2024"],
    appliesToNonCmf: false,
    predicate: (f) =>
      f.regulator?.tipoEntidad === "fintech" && f.regulator?.estadoRPSF === "no_registrada",
  },
  {
    id: "entity.antiguedad_lt6m",
    category: "entity",
    weight: -15,
    reason: "Empresa con menos de 6 meses desde inicio de actividades",
    fundamento:
      "Una entidad que se ofrece como contraparte financiera con menos de 6 meses de existencia formal no ha tenido tiempo de pasar revisiones tributarias ni acumular historial verificable; señal débil pero notoria.",
    legalRefs: ["CL-CT-66"],
    appliesToNonCmf: true,
    predicate: (f) => {
      const months = f.entity?.ageMonths;
      return typeof months === "number" && months >= 0 && months < 6;
    },
  },
] as const;
