import type { Cache } from "../../lib/cache.js";
import { CMFFetchError, FinteChileError } from "../../lib/errors.js";
import { hashInput, logger } from "../../lib/logging.js";
import { score, type ScoreResult } from "../../scoring/engine.js";
import { infoReason } from "../../scoring/info-reasons.js";
import type { Facts } from "../../scoring/rules.js";
import type { ToolDefinition } from "../../server/registry.js";
import type { Storage } from "../../lib/storage.js";

import * as fintechile from "./clients/fintechile.js";
import {
  parseRpsfCsv,
  type RpsfEntry,
  type RpsfListingId,
} from "./parsers/cmf-rpsf.js";
import {
  classifyInput,
  InputShape,
  normalizeRut,
  OutputSchema,
  type Output,
  type WhitelistEntry,
} from "./schema.js";

const TOOL_NAME = "check_whitelist";
const RPSF_SOURCE_URL = "https://www.cmfchile.cl/portal/principal/613/w3-channel.html";
const FINTECHILE_SOURCE_URL = "https://www.fintechile.org/socios";

const RPSF_CACHE_KEY = "rpsf:all";
const RPSF_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const FINTECHILE_CACHE_KEY = "fintechile:members";
const FINTECHILE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const RPSF_FILES: ReadonlyArray<{ id: RpsfListingId; path: string }> = [
  { id: "cmf-rpsf-autorizadas", path: "snapshots/rpsf/autorizadas.csv" },
  { id: "cmf-rpsf-en-revision", path: "snapshots/rpsf/en_revision.csv" },
];

type Input = { input: string };

export interface CheckWhitelistDeps {
  cache: Cache;
  storage: Storage;
  fintechileConfig?: fintechile.FinteChileConfig;
  /** Para tests: inyectar loader RPSF en lugar de leer del File Share. */
  loadRpsfEntries?: () => Promise<ReadonlyArray<RpsfEntry>>;
  /** Para tests: inyectar loader FinteChile sin tocar la red. */
  loadFinteChileMembers?: () => Promise<ReadonlyArray<fintechile.FinteChileMember>>;
  now?: () => number;
}

export function createCheckWhitelistTool(
  deps: CheckWhitelistDeps,
): ToolDefinition<typeof InputShape, Output> {
  const { cache, storage } = deps;
  const now = deps.now ?? Date.now;
  const loadRpsfEntries =
    deps.loadRpsfEntries ?? (() => loadAllRpsfFromStorage(storage));
  const loadFinteChileMembers =
    deps.loadFinteChileMembers ?? (() => fintechile.fetchFinteChileMembers(deps.fintechileConfig));

  return {
    name: TOOL_NAME,
    description:
      "Consulta si una entidad (RUT o nombre) está autorizada o en revisión en el RPSF (Registro de Prestadores de Servicios Financieros, Ley 21.521) o es miembro activo de FinteChile. Retorna multi-fuente con score positivo y razones; si una fuente cae, no rompe el verdict.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const input = rawInput.input.trim();
      const inputType = classifyInput(input);
      const inputHash = hashInput(input);

      const rpsfResult = await checkRpsf(cache, loadRpsfEntries, input, inputType);
      const fintechileResult = await checkFinteChile(cache, loadFinteChileMembers, input);

      const entries: WhitelistEntry[] = [];
      const factsWhitelist: { rpsfStatus?: "autorizada" | "en_revision" | "no_registrada"; fintechileMembership?: boolean } = {};

      let rpsfStatus: "autorizada" | "en_revision" | null = null;
      for (const entry of rpsfResult.entries) {
        entries.push({
          source: entry.source,
          rut: entry.rut.length > 0 ? entry.rut : null,
          nombre: entry.razonSocial,
          estado: entry.estado,
          tipoEntidad: entry.tipoEntidad.length > 0 ? entry.tipoEntidad : null,
          fechaAutorizacion: entry.fechaInscripcion,
          numeroRegistro: entry.numeroRegistro,
        });
        // Si hay autorizada, gana sobre en_revision para el fact.
        if (entry.estado === "autorizada") rpsfStatus = "autorizada";
        else if (rpsfStatus === null) rpsfStatus = "en_revision";
      }
      if (rpsfResult.dataAvailable) {
        factsWhitelist.rpsfStatus = rpsfStatus ?? "no_registrada";
      }

      if (fintechileResult.dataAvailable) {
        factsWhitelist.fintechileMembership = fintechileResult.matches.length > 0;
        for (const m of fintechileResult.matches) {
          entries.push({
            source: "fintechile",
            rut: null,
            nombre: m.nombre,
            estado: "miembro_gremial",
            tipoEntidad: m.categoria,
            fechaAutorizacion: null,
            numeroRegistro: null,
          });
        }
      }

      const sources = [
        {
          name: "cmf-rpsf",
          documentId: "CMF-RPSF-LISTADO",
          articulo: "Artículo 5 — Registro de Prestadores de Servicios Financieros (Ley 21.521)",
          url: RPSF_SOURCE_URL,
          fetchedAt,
          dataAvailable: rpsfResult.dataAvailable,
        },
        {
          name: "fintechile",
          url: FINTECHILE_SOURCE_URL,
          fetchedAt,
          dataAvailable: fintechileResult.dataAvailable,
        },
      ];

      const facts: Facts = { whitelist: factsWhitelist };
      const scored: ScoreResult = score(facts);

      // Info reasons: por cada fuente OK que no produjo match, emitir razón informativa.
      const infoReasons = [];
      if (rpsfResult.dataAvailable && rpsfResult.entries.length === 0) {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "cmf_rpsf_no_match",
            "No figura en el RPSF de la CMF",
            {
              fundamento:
                "Se consultaron los listados oficiales del Registro de Prestadores de Servicios Financieros (autorizadas + en revisión). El input no figura.",
              legalRefs: ["CL-LEY-21521-art-5", "CMF-NCG-514-2024"],
            },
          ),
        );
      }
      if (fintechileResult.dataAvailable && fintechileResult.matches.length === 0) {
        infoReasons.push(
          infoReason(
            TOOL_NAME,
            "fintechile_no_match",
            "No figura como miembro activo de FinteChile",
            {
              fundamento:
                "Se consultó el listado público de socios de FinteChile. El input no figura.",
            },
          ),
        );
      }

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        sourcesQueried: 2,
        sourcesFailed: countFailed([rpsfResult, fintechileResult]),
        hitCount: entries.length,
      });

      return {
        score: scored.score,
        reasons: [...scored.reasons, ...infoReasons],
        sources,
        inWhitelist: entries.length > 0,
        entries,
      };
    },
  };
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

interface RpsfCheckResult {
  dataAvailable: boolean;
  entries: ReadonlyArray<RpsfEntry>;
}

async function checkRpsf(
  cache: Cache,
  loadRpsfEntries: () => Promise<ReadonlyArray<RpsfEntry>>,
  input: string,
  inputType: ReturnType<typeof classifyInput>,
): Promise<RpsfCheckResult> {
  try {
    const entries = await cache.getOrSet(
      RPSF_CACHE_KEY,
      RPSF_CACHE_TTL_SECONDS,
      loadRpsfEntries,
      { staleOnError: true },
    );
    const matches = matchRpsf(entries, input, inputType);
    return { dataAvailable: true, entries: matches };
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

function matchRpsf(
  entries: ReadonlyArray<RpsfEntry>,
  input: string,
  inputType: ReturnType<typeof classifyInput>,
): ReadonlyArray<RpsfEntry> {
  if (inputType === "rut") {
    const target = normalizeRut(input);
    return entries.filter((e) => e.rut === target);
  }
  const lower = input.toLowerCase();
  return entries.filter((e) => e.razonSocial.toLowerCase().includes(lower));
}

interface FinteChileCheckResult {
  dataAvailable: boolean;
  matches: ReadonlyArray<fintechile.FinteChileMember>;
}

async function checkFinteChile(
  cache: Cache,
  loadFinteChileMembers: () => Promise<ReadonlyArray<fintechile.FinteChileMember>>,
  input: string,
): Promise<FinteChileCheckResult> {
  try {
    const members = await cache.getOrSet(
      FINTECHILE_CACHE_KEY,
      FINTECHILE_CACHE_TTL_SECONDS,
      loadFinteChileMembers,
      { staleOnError: true },
    );
    const lower = input.toLowerCase();
    const matches = members.filter((m) => m.nombre.toLowerCase().includes(lower));
    return { dataAvailable: true, matches };
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
    return { dataAvailable: false, matches: [] };
  }
}

function countFailed(
  results: ReadonlyArray<{ dataAvailable: boolean }>,
): number {
  return results.filter((r) => !r.dataAvailable).length;
}

export { OutputSchema } from "./schema.js";
