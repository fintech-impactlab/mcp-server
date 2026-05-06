export type EntityType =
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

export type RpsfEstado = "autorizada" | "en_revision" | "no_registrada";

export interface SiiGiro {
  codigo: string;
  descripcion: string;
}

export interface ClassifierInput {
  nombre: string;
  rpsfTipoEntidad: string | null;
  rpsfEstado: RpsfEstado;
  /**
   * Indica si la fuente RPSF respondió OK. Permite diferenciar
   * `no_fiscalizada` (RPSF respondió y no figura) de `desconocido`
   * (RPSF cayó, no podemos saberlo).
   */
  rpsfDataAvailable: boolean;
  giros: ReadonlyArray<SiiGiro>;
  enListaBancos: boolean;
}

const FINTECH_TIPO_TOKENS: ReadonlyArray<string> = [
  "iniciaci",
  "asesor",
  "plataforma de financiamiento",
  "crowdfunding",
  "custodio",
  "enrutador de órdenes",
  "intermediación",
  "instrumentos financieros",
];

const GIRO_RULES: ReadonlyArray<{ test: (g: SiiGiro) => boolean; type: EntityType }> = [
  {
    test: (g) => g.codigo.startsWith("6411") || /banca múltiple|banco/i.test(g.descripcion),
    type: "banco",
  },
  {
    test: (g) => /cooperativa.*ahorro|ahorro.*crédito/i.test(g.descripcion),
    type: "cooperativa",
  },
  {
    test: (g) => /caja.*compensación|compensación.*familiar/i.test(g.descripcion),
    type: "caja_compensacion",
  },
  {
    test: (g) => g.codigo.startsWith("6612") || /casa.*cambio|cambio.*moneda/i.test(g.descripcion),
    type: "casa_cambio",
  },
  {
    test: (g) =>
      g.codigo.startsWith("6520") ||
      /tarjetas? de crédito|tarjetas? de débito/i.test(g.descripcion),
    type: "emisor_tarjetas",
  },
  {
    test: (g) =>
      g.codigo.startsWith("6491") ||
      /servicio.*pago|transferencias? de fondos|asesor.*inversión|tecnología.*financiera/i.test(
        g.descripcion,
      ),
    type: "fintech",
  },
];

function isFintechFromRpsf(tipo: string | null): boolean {
  if (tipo === null) return false;
  const lower = tipo.toLowerCase();
  return FINTECH_TIPO_TOKENS.some((token) => lower.includes(token.toLowerCase()));
}

function classifyByGiros(giros: ReadonlyArray<SiiGiro>): EntityType | null {
  for (const giro of giros) {
    for (const rule of GIRO_RULES) {
      if (rule.test(giro)) return rule.type;
    }
  }
  return null;
}

function nameSuggestsCredit(nombre: string): boolean {
  return /\bcrédito|\bcredit\b|prestam[oi]s?/i.test(nombre);
}

function isEcommerceGiro(giros: ReadonlyArray<SiiGiro>): boolean {
  return giros.some(
    (g) => g.codigo.startsWith("4791") || /por internet|comercio electrónico/i.test(g.descripcion),
  );
}

function isLendingGiro(giros: ReadonlyArray<SiiGiro>): boolean {
  return giros.some(
    (g) =>
      g.codigo.startsWith("6492") ||
      /otorgamiento de crédito|servicios financieros/i.test(g.descripcion),
  );
}

export function classifyEntity(input: ClassifierInput): EntityType {
  if (input.enListaBancos) return "banco";
  if ((input.rpsfEstado === "autorizada" || input.rpsfEstado === "en_revision") && isFintechFromRpsf(input.rpsfTipoEntidad)) {
    return "fintech";
  }
  const fromGiro = classifyByGiros(input.giros);
  if (fromGiro !== null) return fromGiro;
  if (isEcommerceGiro(input.giros) && nameSuggestsCredit(input.nombre)) {
    return "ecommerce_credito";
  }
  if (isLendingGiro(input.giros)) return "prestamista_no_regulado";
  // Si RPSF respondió y no figura (estado por default = "no_registrada"),
  // marcamos `no_fiscalizada`: información accionable. `desconocido` queda
  // reservado para cuando RPSF no respondió (no se pudo verificar).
  if (input.rpsfDataAvailable && input.rpsfEstado === "no_registrada") {
    return "no_fiscalizada";
  }
  return "desconocido";
}
