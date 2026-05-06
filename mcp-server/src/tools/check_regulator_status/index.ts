import { normsFor } from "../../constants/cmf-norms-mapping.js";
import type { Cache } from "../../lib/cache.js";
import { CMFFetchError, FinteChileError } from "../../lib/errors.js";
import { hashInput, logger } from "../../lib/logging.js";
import { score, type ScoreResult } from "../../scoring/engine.js";
import { infoReason } from "../../scoring/info-reasons.js";
import type { Facts } from "../../scoring/rules.js";
import type { ToolDefinition } from "../../server/registry.js";
import type { Storage } from "../../lib/storage.js";

import * as fintechile from "../check_whitelist/clients/fintechile.js";
import {
  parseRpsfCsv,
  type RpsfEntry,
  type RpsfListingId,
} from "../check_whitelist/parsers/cmf-rpsf.js";

import { classifyEntity, type EntityType, type SiiGiro } from "./classifier.js";
import { classifyQuery, InputShape, type Output } from "./schema.js";

const TOOL_NAME = "check_regulator_status";

type Input = { rutOrName: string };

const RPSF_CACHE_KEY = "rpsf:all";
const RPSF_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const FINTECHILE_CACHE_KEY = "fintechile:members";
const FINTECHILE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const RPSF_FILES: ReadonlyArray<{ id: RpsfListingId; path: string }> = [
  { id: "cmf-rpsf-autorizadas", path: "snapshots/rpsf/autorizadas.csv" },
  { id: "cmf-rpsf-en-revision", path: "snapshots/rpsf/en_revision.csv" },
];

export interface CheckRegulatorStatusDeps {
  cache: Cache;
  storage: Storage;
  fintechileConfig?: fintechile.FinteChileConfig;
  loadRpsfEntries?: () => Promise<ReadonlyArray<RpsfEntry>>;
  loadFinteChileMembers?: () => Promise<ReadonlyArray<fintechile.FinteChileMember>>;
  /** Para tests: lista estática de bancos. En producción se carga del File Share. */
  bancosList?: ReadonlyArray<string>;
  /** Para tests: lookup de giros SII por nombre/RUT. */
  loadSiiGiros?: (query: string) => Promise<ReadonlyArray<SiiGiro>>;
  now?: () => number;
}

export function createCheckRegulatorStatusTool(
  deps: CheckRegulatorStatusDeps,
): ToolDefinition<typeof InputShape, Output> {
  const { cache, storage } = deps;
  const now = deps.now ?? Date.now;
  const loadRpsfEntries =
    deps.loadRpsfEntries ?? (() => loadAllRpsfFromStorage(storage));
  const loadFinteChileMembers =
    deps.loadFinteChileMembers ?? (() => fintechile.fetchFinteChileMembers(deps.fintechileConfig));
  const loadSiiGiros = deps.loadSiiGiros ?? (async () => []);
  const bancosList = (deps.bancosList ?? DEFAULT_BANCOS).map((s) => s.toLowerCase());

  return {
    name: TOOL_NAME,
    description:
      "Determina el tipo de entidad financiera (banco, fintech, cooperativa, casa de cambio, etc.) a partir de RPSF, FinteChile y giros del SII. Retorna estado regulatorio, normativas aplicables y score según consistencia.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const query = rawInput.rutOrName.trim();
      const queryType = classifyQuery(query);
      const inputHash = hashInput(query);

      const rpsf = await loadRpsfSafe(cache, loadRpsfEntries);
      const fintechile = await loadFinteChileSafe(cache, loadFinteChileMembers);
      const giros = await loadGirosSafe(loadSiiGiros, query);

      const rpsfMatches = rpsf.dataAvailable ? matchRpsf(rpsf.entries, query, queryType) : [];
      const rpsfMatch = rpsfMatches[0] ?? null;
      const estadoRPSF: "autorizada" | "en_revision" | "no_registrada" =
        rpsfMatch?.estado ?? "no_registrada";
      const numeroRegistro = rpsfMatch?.numeroRegistro ?? null;
      const enListaBancos = bancosList.some((b) => query.toLowerCase().includes(b));

      const tipoEntidad: EntityType = classifyEntity({
        nombre: query,
        rpsfTipoEntidad: rpsfMatch?.tipoEntidad ?? null,
        rpsfEstado: estadoRPSF,
        rpsfDataAvailable: rpsf.dataAvailable,
        giros,
        enListaBancos,
      });

      const membresiaFinteChile = fintechile.dataAvailable
        ? fintechile.members.some((m) => m.nombre.toLowerCase().includes(query.toLowerCase()))
        : false;

      const giroConsistente = checkConsistency(tipoEntidad, giros);

      const facts: Facts = {
        regulator: {
          tipoEntidad,
          estadoRPSF,
          giroConsistente,
        },
      };
      const scored: ScoreResult = score(facts);

      // Info reasons: por fuente OK que no contribuyó signal rule.
      const firedRules = new Set(scored.reasons.map((r) => r.ruleId));
      const regulatorRuleFired = [...firedRules].some((id) => id.startsWith("regulator."));
      const infoReasons = [];
      if (rpsf.dataAvailable && !regulatorRuleFired && rpsfMatches.length === 0) {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "cmf_rpsf_no_match",
            "No figura en el RPSF (Ley 21.521)",
            {
              fundamento:
                "Se consultó el Registro de Prestadores de Servicios Financieros; el RUT/nombre no figura como autorizado ni en revisión.",
              legalRefs: ["CL-LEY-21521-art-5", "CMF-NCG-514-2024"],
            },
          ),
        );
      }
      if (fintechile.dataAvailable && !membresiaFinteChile) {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "fintechile_no_match",
            "No figura como miembro activo de FinteChile",
            {
              fundamento: "Se consultó el listado público de socios de FinteChile.",
            },
          ),
        );
      }
      if (giros.length > 0 && !regulatorRuleFired) {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "sii_giros_verified",
            `Giros SII verificados (${giros.length}); no disparan reglas regulatorias`,
            {
              fundamento:
                "Los giros declarados en el SII no apuntan a operación fintech inscrita ni a giro inconsistente con la categoría detectada.",
              legalRefs: ["CL-CT-66"],
            },
          ),
        );
      }

      const sources = [
        {
          name: "cmf-rpsf",
          documentId: "CMF-NCG-514-2024",
          articulo: "Sección I.C — Registro de Prestadores de Servicios Basados en Información",
          fetchedAt,
          dataAvailable: rpsf.dataAvailable,
        },
        { name: "fintechile", fetchedAt, dataAvailable: fintechile.dataAvailable },
        {
          name: "sii-giros",
          documentId: "CL-CT-66",
          articulo: "Artículo 66 — Inicio de actividades y giro tributario",
          fetchedAt,
          dataAvailable: giros.length > 0,
        },
      ];

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        tipoEntidad,
        estadoRPSF,
        sourcesQueried: 3,
        sourcesFailed: countFailed([rpsf, fintechile]) + (giros.length === 0 ? 1 : 0),
      });

      return {
        score: scored.score,
        reasons: [...scored.reasons, ...infoReasons],
        sources,
        query,
        tipoEntidad,
        estadoRPSF,
        numeroRegistro,
        membresiaFinteChile,
        giroConsistente,
        normativasAplicables: [...normsFor(tipoEntidad)],
      };
    },
  };
}

const DEFAULT_BANCOS: ReadonlyArray<string> = [
  "banco de chile",
  "banco santander",
  "banco bci",
  "banco estado",
  "banco bice",
  "banco itaú",
  "banco internacional",
  "banco security",
  "banco falabella",
  "banco ripley",
  "scotiabank",
  "hsbc",
];

interface RpsfLoadResult {
  dataAvailable: boolean;
  entries: ReadonlyArray<RpsfEntry>;
}

async function loadRpsfSafe(
  cache: Cache,
  loadRpsfEntries: () => Promise<ReadonlyArray<RpsfEntry>>,
): Promise<RpsfLoadResult> {
  try {
    const entries = await cache.getOrSet(
      RPSF_CACHE_KEY,
      RPSF_CACHE_TTL_SECONDS,
      loadRpsfEntries,
      { staleOnError: true },
    );
    return { dataAvailable: true, entries };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "cmf-rpsf",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof CMFFetchError ? err.retriable : false,
      },
      "error",
    );
    return { dataAvailable: false, entries: [] };
  }
}

interface FinteChileLoadResult {
  dataAvailable: boolean;
  members: ReadonlyArray<fintechile.FinteChileMember>;
}

async function loadFinteChileSafe(
  cache: Cache,
  loadFinteChileMembers: () => Promise<ReadonlyArray<fintechile.FinteChileMember>>,
): Promise<FinteChileLoadResult> {
  try {
    const members = await cache.getOrSet(
      FINTECHILE_CACHE_KEY,
      FINTECHILE_CACHE_TTL_SECONDS,
      loadFinteChileMembers,
      { staleOnError: true },
    );
    return { dataAvailable: true, members };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "fintechile",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof FinteChileError ? err.retriable : false,
      },
      "error",
    );
    return { dataAvailable: false, members: [] };
  }
}

async function loadGirosSafe(
  loader: (query: string) => Promise<ReadonlyArray<SiiGiro>>,
  query: string,
): Promise<ReadonlyArray<SiiGiro>> {
  try {
    return await loader(query);
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "sii-giros",
        message: err instanceof Error ? err.message : String(err),
        retriable: false,
      },
      "error",
    );
    return [];
  }
}

function matchRpsf(
  entries: ReadonlyArray<RpsfEntry>,
  query: string,
  queryType: ReturnType<typeof classifyQuery>,
): ReadonlyArray<RpsfEntry> {
  if (queryType === "rut") {
    const target = query.replace(/\./g, "").toUpperCase();
    return entries.filter((e) => e.rut === target);
  }
  const lower = query.toLowerCase();
  return entries.filter((e) => e.razonSocial.toLowerCase().includes(lower));
}

async function loadAllRpsfFromStorage(
  storage: Storage,
): Promise<ReadonlyArray<RpsfEntry>> {
  const all: RpsfEntry[] = [];
  for (const { id, path } of RPSF_FILES) {
    let buf: Buffer;
    try {
      buf = await storage.readFile(path);
    } catch (err) {
      throw new CMFFetchError(`No se pudo leer ${path} desde el File Share`, {
        cause: err,
        retriable: false,
      });
    }
    all.push(...parseRpsfCsv(buf.toString("utf-8"), id));
  }
  return all;
}

function checkConsistency(type: EntityType, giros: ReadonlyArray<SiiGiro>): boolean {
  if (giros.length === 0) return false;
  switch (type) {
    case "banco":
      return giros.some((g) => g.codigo.startsWith("6411") || /banco|banca/i.test(g.descripcion));
    case "fintech":
      return giros.some(
        (g) =>
          g.codigo.startsWith("6491") ||
          g.codigo.startsWith("6492") ||
          g.codigo.startsWith("6499") ||
          /servicio.*pago|tecnología|asesor/i.test(g.descripcion),
      );
    case "cooperativa":
      return giros.some((g) => /cooperativa/i.test(g.descripcion));
    case "casa_cambio":
      return giros.some(
        (g) => g.codigo.startsWith("6612") || /casa.*cambio|cambio.*moneda/i.test(g.descripcion),
      );
    case "emisor_tarjetas":
      return giros.some(
        (g) => g.codigo.startsWith("6520") || /tarjetas? de crédito/i.test(g.descripcion),
      );
    case "caja_compensacion":
      return giros.some((g) => /caja.*compensación/i.test(g.descripcion));
    case "ecommerce_credito":
      return giros.some(
        (g) => g.codigo.startsWith("4791") || /por internet/i.test(g.descripcion),
      );
    case "prestamista_no_regulado":
      return giros.some(
        (g) => g.codigo.startsWith("6492") || /servicios financieros/i.test(g.descripcion),
      );
    default:
      return false;
  }
}

function countFailed(results: ReadonlyArray<{ dataAvailable: boolean }>): number {
  return results.filter((r) => !r.dataAvailable).length;
}

export { OutputSchema } from "./schema.js";
