import { BCEError } from "../../lib/errors.js";
import { hashInput, logger } from "../../lib/logging.js";
import type { Cache } from "../../lib/cache.js";
import type { ToolDefinition } from "../../server/registry.js";

import { fetchRates, type BceClientConfig } from "./client.js";
import { InputShape, OutputSchema, type Output } from "./schema.js";

const TOOL_NAME = "get_market_reference_rates";
const SOURCE_NAME = "bce-bde";
const SOURCE_URL = "https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx";
const CACHE_KEY = "rates:bce:current";
const CACHE_TTL_SECONDS = 86_400;

export interface GetMarketReferenceRatesDeps {
  cache: Cache;
  bceConfig: BceClientConfig;
  fetcher?: typeof fetchRates;
  /** Override clock for tests (default Date.now). */
  now?: () => number;
}

export function createGetMarketReferenceRatesTool(
  deps: GetMarketReferenceRatesDeps,
): ToolDefinition<typeof InputShape, Output> {
  const { cache, bceConfig } = deps;
  const fetcher = deps.fetcher ?? fetchRates;
  const now = deps.now ?? Date.now;

  return {
    name: TOOL_NAME,
    description:
      "Consulta tasas de referencia oficiales del Banco Central de Chile (TPM, tasa máxima convencional, tasa de interés promedio del sistema bancario). Sustenta el contraste cuantitativo de promesas de rentabilidad.",
    inputSchema: InputShape,
    handler: async (): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      let staleSinceIso: string | undefined;

      try {
        const rates = await cache.getOrSet(
          CACHE_KEY,
          CACHE_TTL_SECONDS,
          () => fetcher(bceConfig),
          {
            staleOnError: true,
            onStaleHit: (cachedAt) => {
              staleSinceIso = new Date(cachedAt).toISOString();
            },
          },
        );

        logger.event("tool.call", {
          toolName: TOOL_NAME,
          inputHash: hashInput(""),
          durationMs: now() - startTime,
          success: true,
          source: "bce",
          stale: staleSinceIso !== undefined,
        });

        const source = {
          name: SOURCE_NAME,
          url: SOURCE_URL,
          fetchedAt,
          dataAvailable: true,
          ...(staleSinceIso !== undefined ? { staleSince: staleSinceIso } : {}),
        };

        return {
          score: 0,
          reasons: [],
          sources: [source],
          rates,
        };
      } catch (err) {
        const isBceError = err instanceof BCEError;
        logger.event(
          "tool.error",
          {
            toolName: TOOL_NAME,
            source: "bce",
            message: err instanceof Error ? err.message : String(err),
            retriable: isBceError ? err.retriable : false,
          },
          "error",
        );
        logger.event("tool.call", {
          toolName: TOOL_NAME,
          inputHash: hashInput(""),
          durationMs: now() - startTime,
          success: false,
          source: "bce",
        });

        return {
          score: 0,
          reasons: [],
          sources: [
            {
              name: SOURCE_NAME,
              url: SOURCE_URL,
              fetchedAt,
              dataAvailable: false,
            },
          ],
          disclaimer:
            "Tasas BCE no disponibles temporalmente. Reintentar más tarde; el verdict de otras tools no se ve afectado.",
        };
      }
    },
  };
}
