import type { z } from "zod";

import type { Cache } from "../../lib/cache.js";
import { BCNError } from "../../lib/errors.js";
import { hashInput, logger } from "../../lib/logging.js";
import type { ToolDefinition } from "../../server/registry.js";

import { fetchLawExplanation, type BcnClientConfig, type LawExplanation } from "./client.js";
import { InputShape, OutputSchema, type Output } from "./schema.js";

const TOOL_NAME = "explain_law_simple";
const SOURCE_NAME = "bcn-ley-facil";
const SOURCE_URL = "https://www.bcn.cl/api-leyfacil/servicio/ObtenerGuiaPublicadaHTML";
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 días

type Input = {
  [K in keyof typeof InputShape]: z.infer<(typeof InputShape)[K]>;
};

export interface ExplainLawSimpleDeps {
  cache: Cache;
  bcnConfig: BcnClientConfig;
  fetcher?: typeof fetchLawExplanation;
  now?: () => number;
}

export function createExplainLawSimpleTool(
  deps: ExplainLawSimpleDeps,
): ToolDefinition<typeof InputShape, Output> {
  const { cache, bcnConfig } = deps;
  const fetcher = deps.fetcher ?? fetchLawExplanation;
  const now = deps.now ?? Date.now;

  return {
    name: TOOL_NAME,
    description:
      "Devuelve la explicación ciudadana oficial de una ley chilena (texto en lenguaje simple, tema, derechos, palabras clave) consumida desde la API de Ley Fácil de la Biblioteca del Congreso Nacional. Riesgo de alucinación: nulo.",
    inputSchema: InputShape,
    handler: async (input: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const articulo = input.articulo ?? null;
      const cacheKey = `bcn:ley:${input.leyId}:${articulo ?? "all"}`;
      let staleSinceIso: string | undefined;

      try {
        const explanation = await cache.getOrSet(
          cacheKey,
          CACHE_TTL_SECONDS,
          () => fetcher(bcnConfig, { leyId: input.leyId, articulo: articulo ?? undefined }),
          {
            staleOnError: true,
            onStaleHit: (cachedAt) => {
              staleSinceIso = new Date(cachedAt).toISOString();
            },
          },
        );

        logger.event("tool.call", {
          toolName: TOOL_NAME,
          inputHash: hashInput(`${input.leyId}|${articulo ?? ""}`),
          durationMs: now() - startTime,
          success: true,
          source: "bcn",
          stale: staleSinceIso !== undefined,
        });

        const source = {
          name: SOURCE_NAME,
          documentId: "EXT-BCN-LEY-FACIL",
          ...(articulo !== undefined ? { articulo: `Artículo ${articulo}` } : {}),
          url: SOURCE_URL,
          fetchedAt,
          dataAvailable: true,
          ...(staleSinceIso !== undefined ? { staleSince: staleSinceIso } : {}),
        };

        return {
          score: 0,
          reasons: [],
          sources: [source],
          explanation: explanation satisfies LawExplanation,
        };
      } catch (err) {
        const isBcnError = err instanceof BCNError;
        logger.event(
          "tool.error",
          {
            toolName: TOOL_NAME,
            source: "bcn",
            message: err instanceof Error ? err.message : String(err),
            retriable: isBcnError ? err.retriable : false,
          },
          "error",
        );
        logger.event("tool.call", {
          toolName: TOOL_NAME,
          inputHash: hashInput(`${input.leyId}|${articulo ?? ""}`),
          durationMs: now() - startTime,
          success: false,
          source: "bcn",
        });

        const userFacing = isBcnError
          ? err.userFacing
          : "BCN Ley Fácil temporalmente no disponible. Reintentar más tarde.";

        return {
          score: 0,
          reasons: [],
          sources: [
            {
              name: SOURCE_NAME,
              documentId: "EXT-BCN-LEY-FACIL",
              url: SOURCE_URL,
              fetchedAt,
              dataAvailable: false,
            },
          ],
          disclaimer: userFacing,
        };
      }
    },
  };
}
