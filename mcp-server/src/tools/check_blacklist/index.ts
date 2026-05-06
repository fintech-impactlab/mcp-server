import type { Cache } from "../../lib/cache.js";
import { CMFFetchError, PhishTankError, URLhausError } from "../../lib/errors.js";
import { hashInput, logger } from "../../lib/logging.js";
import { score, type ScoreResult } from "../../scoring/engine.js";
import type { Facts } from "../../scoring/rules.js";
import type { ToolDefinition } from "../../server/registry.js";
import type { Storage } from "../../lib/storage.js";

import * as phishtank from "./clients/phishtank.js";
import * as urlhaus from "./clients/urlhaus.js";
import { parseCmfCsv, type CmfBlacklistEntry, type CmfListingId } from "./parsers/cmf.js";
import { classifyInput, InputShape, OutputSchema, type Hit, type Output } from "./schema.js";

const TOOL_NAME = "check_blacklist";
const SOURCE_URL = "https://www.cmfchile.cl/portal/principal/613/w3-channel.html";
const CMF_CACHE_KEY = "cmf:blacklist:all";
const CMF_CACHE_TTL_SECONDS = 24 * 60 * 60;

const CMF_FILES: ReadonlyArray<{ id: CmfListingId; path: string }> = [
  { id: "cmf-plataformas-no-reguladas", path: "snapshots/cmf/plataformas_inversion_no_reguladas.csv" },
  { id: "cmf-apps-creditos-no-reguladas", path: "snapshots/cmf/apps_creditos_no_reguladas.csv" },
  { id: "cmf-creditos-fraudulentos", path: "snapshots/cmf/creditos_fraudulentos.csv" },
  { id: "cmf-otras-entidades-no-reguladas", path: "snapshots/cmf/otras_entidades_no_reguladas.csv" },
];

type Input = { input: string };

export interface CheckBlacklistDeps {
  cache: Cache;
  storage: Storage;
  phishtankConfig?: phishtank.PhishTankConfig;
  urlhausConfig?: urlhaus.URLhausConfig;
  /** For tests: inject a CMF loader instead of using `storage`. */
  loadCmfEntries?: () => Promise<ReadonlyArray<CmfBlacklistEntry>>;
  now?: () => number;
}

export function createCheckBlacklistTool(
  deps: CheckBlacklistDeps,
): ToolDefinition<typeof InputShape, Output> {
  const { cache, storage } = deps;
  const now = deps.now ?? Date.now;
  const loadCmfEntries =
    deps.loadCmfEntries ?? (() => loadAllCmfFromStorage(storage));

  return {
    name: TOOL_NAME,
    description:
      "Consulta si una entidad o URL aparece en listas negras conocidas: 4 listados oficiales de la CMF (Plataformas / Apps Crédito / Créditos Fraudulentos / Otras), PhishTank y URLhaus. Retorna hits multi-fuente, score parcial y razones; si una fuente cae, no rompe el verdict.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const input = rawInput.input.trim();
      const inputType = classifyInput(input);
      const inputHash = hashInput(input);

      const cmfHits = await checkCmf(cache, loadCmfEntries, input, inputType);
      const phishtankResult = await checkPhishTankSafe(deps.phishtankConfig, input, inputType);
      const urlhausResult = await checkURLhausSafe(deps.urlhausConfig, input, inputType);

      const hits: Hit[] = [];
      const sources = [
        {
          name: "cmf-alertas",
          url: SOURCE_URL,
          fetchedAt,
          dataAvailable: cmfHits.dataAvailable,
        },
        {
          name: "phishtank",
          url: "https://www.phishtank.com/",
          fetchedAt,
          dataAvailable: phishtankResult.dataAvailable,
        },
        {
          name: "urlhaus",
          url: "https://urlhaus.abuse.ch/",
          fetchedAt,
          dataAvailable: urlhausResult.dataAvailable,
        },
      ];

      const factsBlacklistSources: string[] = [];
      for (const entry of cmfHits.entries) {
        hits.push({
          source: entry.source,
          identifier: entry.identifier,
          identifierType: entry.identifierType,
          listedAt: entry.listedAt,
          detailUrl: null,
        });
        if (!factsBlacklistSources.includes(entry.source)) {
          factsBlacklistSources.push(entry.source);
        }
      }
      if (phishtankResult.hit !== null) {
        hits.push(phishtankResult.hit);
        factsBlacklistSources.push("phishtank");
      }
      if (urlhausResult.hit !== null) {
        hits.push(urlhausResult.hit);
        factsBlacklistSources.push("urlhaus");
      }

      const facts: Facts = { blacklist: { sources: factsBlacklistSources } };
      const scored: ScoreResult = score(facts);

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        sourcesQueried: 3,
        sourcesFailed: countFailed([cmfHits, phishtankResult, urlhausResult]),
        hitCount: hits.length,
      });

      return {
        score: scored.score,
        reasons: [...scored.reasons],
        sources,
        inBlacklist: hits.length > 0,
        hits,
      };
    },
  };
}

async function loadAllCmfFromStorage(
  storage: Storage,
): Promise<ReadonlyArray<CmfBlacklistEntry>> {
  const all: CmfBlacklistEntry[] = [];
  for (const { id, path } of CMF_FILES) {
    let buf: Buffer;
    try {
      buf = await storage.readFile(path);
    } catch (err) {
      throw new CMFFetchError(`No se pudo leer ${path} desde el File Share`, {
        cause: err,
        retriable: false,
      });
    }
    all.push(...parseCmfCsv(buf.toString("utf-8"), id));
  }
  return all;
}

interface CmfCheckResult {
  dataAvailable: boolean;
  entries: ReadonlyArray<CmfBlacklistEntry>;
}

async function checkCmf(
  cache: Cache,
  loadCmfEntries: () => Promise<ReadonlyArray<CmfBlacklistEntry>>,
  input: string,
  inputType: ReturnType<typeof classifyInput>,
): Promise<CmfCheckResult> {
  try {
    const entries = await cache.getOrSet(
      CMF_CACHE_KEY,
      CMF_CACHE_TTL_SECONDS,
      loadCmfEntries,
      { staleOnError: true },
    );
    const matches = matchCmfEntries(entries, input, inputType);
    return { dataAvailable: true, entries: matches };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "cmf-alertas",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof CMFFetchError ? err.retriable : false,
      },
      "error",
    );
    return { dataAvailable: false, entries: [] };
  }
}

function matchCmfEntries(
  entries: ReadonlyArray<CmfBlacklistEntry>,
  input: string,
  inputType: ReturnType<typeof classifyInput>,
): ReadonlyArray<CmfBlacklistEntry> {
  const lower = input.toLowerCase();
  return entries.filter((entry) => {
    if (inputType === "url" || inputType === "domain") {
      if (entry.url !== null && entry.url.toLowerCase().includes(lower)) return true;
    }
    if (entry.name.toLowerCase().includes(lower)) return true;
    return false;
  });
}

interface ExternalCheckResult {
  dataAvailable: boolean;
  hit: Hit | null;
}

async function checkPhishTankSafe(
  config: phishtank.PhishTankConfig | undefined,
  input: string,
  inputType: ReturnType<typeof classifyInput>,
): Promise<ExternalCheckResult> {
  if (config === undefined || (inputType !== "url" && inputType !== "domain")) {
    return { dataAvailable: false, hit: null };
  }
  try {
    const result = await phishtank.checkUrl(config, input);
    if (!result.inDatabase) return { dataAvailable: true, hit: null };
    return {
      dataAvailable: true,
      hit: {
        source: "phishtank",
        identifier: input,
        identifierType: "url",
        listedAt: result.reportedAt ?? null,
        detailUrl: result.phishUrl ?? null,
      },
    };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "phishtank",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof PhishTankError ? err.retriable : false,
      },
      "error",
    );
    return { dataAvailable: false, hit: null };
  }
}

async function checkURLhausSafe(
  config: urlhaus.URLhausConfig | undefined,
  input: string,
  inputType: ReturnType<typeof classifyInput>,
): Promise<ExternalCheckResult> {
  if (config === undefined || (inputType !== "url" && inputType !== "domain")) {
    return { dataAvailable: false, hit: null };
  }
  try {
    const result = await urlhaus.checkUrl(config, input);
    if (result.status === "no_results") return { dataAvailable: true, hit: null };
    return {
      dataAvailable: true,
      hit: {
        source: "urlhaus",
        identifier: input,
        identifierType: "url",
        listedAt: result.reportedAt,
        detailUrl: result.detailUrl,
      },
    };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "urlhaus",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof URLhausError ? err.retriable : false,
      },
      "error",
    );
    return { dataAvailable: false, hit: null };
  }
}

function countFailed(
  results: ReadonlyArray<{ dataAvailable: boolean }>,
): number {
  return results.filter((r) => !r.dataAvailable).length;
}

export { OutputSchema } from "./schema.js";
