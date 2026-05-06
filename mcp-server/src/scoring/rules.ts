// Tabla declarativa de reglas de scoring. **Sin LLM, sin random, sin Date.now**.
// Cada predicate es una función pura sobre Facts. Cada peso (weight) tiene su
// fundamento documentado y entra acotado en [-50, +50].
//
// Las reglas crecen junto a las tools: blacklist en Slice 4, whitelist en
// Slice 5, regulator en Slice 9, etc. Acá vive el set inicial mínimo (≥12)
// que cubre las 4 categorías que ya pueden alimentarse con facts (domain,
// blacklist, whitelist, entity), suficiente para validar el motor (Slice 1.2)
// y CP-A.

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

export interface Facts {
  domain?: DomainFacts;
  blacklist?: BlacklistFacts;
  whitelist?: WhitelistFacts;
  entity?: EntityFacts;
  dns?: DnsFacts;
}

export interface Rule {
  readonly id: string;
  readonly category: RuleCategory;
  readonly weight: number;
  readonly reason: string;
  readonly fundamento: string;
  readonly predicate: (facts: Facts) => boolean;
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
    predicate: (f) => f.domain?.sslStatus === "self_signed",
  },
  {
    id: "domain.ssl_invalid",
    category: "domain",
    weight: -40,
    reason: "Certificado SSL inválido o expirado",
    fundamento:
      "SSL inválido o vencido invalida cualquier promesa de seguridad de transporte y suele indicar abandono operacional o fraude descuidado.",
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
    predicate: (f) => f.domain?.sslStatus === "missing",
  },
  {
    id: "domain.too_many_redirects",
    category: "domain",
    weight: -15,
    reason: "Cadena de redirecciones >3 hops",
    fundamento:
      "Cadenas largas de redirección entre dominios opacan el destino real y son típicas de campañas de scam que lavan tráfico via cloaking. ≥4 hops es señal débil pero notoria.",
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
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-plataformas-no-reguladas"),
  },
  {
    id: "blacklist.cmf_creditos_fraudulentos",
    category: "blacklist",
    weight: -50,
    reason: "Aparece en CMF — Créditos Fraudulentos",
    fundamento:
      "Listado oficial CMF de operadores de crédito fraudulento. Inclusión es señal regulatoria dura.",
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-creditos-fraudulentos"),
  },
  {
    id: "blacklist.phishtank",
    category: "blacklist",
    weight: -40,
    reason: "URL reportada en PhishTank",
    fundamento:
      "PhishTank confirma reportes vía verificación comunitaria. False positives son raros en URLs verified.",
    predicate: (f) => blacklistHas(f.blacklist?.sources, "phishtank"),
  },
  {
    id: "blacklist.cmf_apps_creditos_no_reguladas",
    category: "blacklist",
    weight: -50,
    reason: "Aparece en CMF — Apps de Créditos No Reguladas",
    fundamento:
      "Listado oficial CMF de apps de crédito sin autorización formal. Misma fuerza señalética que Plataformas / Créditos Fraudulentos.",
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-apps-creditos-no-reguladas"),
  },
  {
    id: "blacklist.cmf_otras_entidades_no_reguladas",
    category: "blacklist",
    weight: -50,
    reason: "Aparece en CMF — Otras Entidades No Reguladas",
    fundamento:
      "Listado oficial CMF que captura ofertas financieras fuera del perímetro regulado que no encajan en los otros 3 listados.",
    predicate: (f) => blacklistHas(f.blacklist?.sources, "cmf-otras-entidades-no-reguladas"),
  },
  {
    id: "blacklist.urlhaus",
    category: "blacklist",
    weight: -30,
    reason: "URL reportada en URLhaus",
    fundamento:
      "URLhaus de abuse.ch lista URLs activas asociadas a malware. Hit confirma intencionalidad maliciosa, peso menor que listados regulatorios chilenos pero suma.",
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
    predicate: (f) => f.whitelist?.rpsfStatus === "autorizada",
  },
  {
    id: "whitelist.rpsf_en_revision",
    category: "whitelist",
    weight: 10,
    reason: "Solicitud presente en RPSF, en revisión por CMF",
    fundamento:
      "Período transitorio Ley 21.521: la entidad opera legalmente mientras CMF resuelve. No es garantía pero es señal positiva intermedia (179 autorizadas + 300 en revisión a feb 2025).",
    predicate: (f) => f.whitelist?.rpsfStatus === "en_revision",
  },
  {
    id: "whitelist.fintechile_miembro",
    category: "whitelist",
    weight: 15,
    reason: "Miembro activo de FinteChile",
    fundamento:
      "Membresía gremial implica al menos un nivel mínimo de escrutinio entre pares; señal positiva intermedia mientras la Ley Fintech termina de implementarse.",
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
    predicate: (f) => f.dns?.registrantCountry === "CL",
  },
  {
    id: "dns.registrant_anonimo",
    category: "dns",
    weight: -15,
    reason: "Registrante WHOIS/RDAP anonimizado vía privacy proxy",
    fundamento:
      "Privacidad proxy es legítima en general, pero un proveedor financiero serio publica datos verificables del registrante. Anonimato + servicio financiero = bandera de opacidad.",
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
    predicate: (f) => f.entity?.siiStatus === "activo",
  },
  {
    id: "entity.sii_suspendido",
    category: "entity",
    weight: -30,
    reason: "Estado 'suspendido' en el SII",
    fundamento:
      "Suspensión SII es señal regulatoria dura: la entidad no debería estar realizando operaciones con público mientras esté en ese estado.",
    predicate: (f) => f.entity?.siiStatus === "suspendido",
  },
  {
    id: "entity.sii_sin_inicio",
    category: "entity",
    weight: -50,
    reason: "Sin inicio de actividades en el SII",
    fundamento:
      "Si una empresa que ofrece servicios financieros no figura con inicio de actividades, no existe formalmente en el sistema tributario chileno; es prácticamente concluyente.",
    predicate: (f) => f.entity?.siiStatus === "sin_inicio",
  },
] as const;
