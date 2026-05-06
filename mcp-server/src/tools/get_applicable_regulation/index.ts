import { CMF_NORMS } from "../../constants/cmf-norms.js";
import { LAWS } from "../../constants/laws.js";
import {
  lookupRegulation,
  type Situacion,
} from "../../constants/regulation-matrix.js";
import { catalogIdFromInternal } from "../../lib/legal-catalog.js";
import { hashInput, logger } from "../../lib/logging.js";
import type { ToolDefinition } from "../../server/registry.js";
import type { EntityType } from "../check_regulator_status/classifier.js";

import { InputShape, type Output } from "./schema.js";

const TOOL_NAME = "get_applicable_regulation";

type Input = { tipoEntidad: EntityType; situacion: Situacion };

const lawIndex = new Map(LAWS.map((l) => [l.id, l]));
const normIndex = new Map(CMF_NORMS.map((n) => [n.id, n]));

export interface GetApplicableRegulationDeps {
  now?: () => number;
}

export function createGetApplicableRegulationTool(
  deps: GetApplicableRegulationDeps = {},
): ToolDefinition<typeof InputShape, Output> {
  const now = deps.now ?? Date.now;

  return {
    name: TOOL_NAME,
    description:
      "Devuelve las leyes y normativas CMF aplicables a una combinación (tipoEntidad, situación) más derechos del usuario y plazos legales asociados. Catálogo determinístico en código (sin LLM); citable y auditable.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const inputHash = hashInput(`${rawInput.tipoEntidad}/${rawInput.situacion}`);

      const entry = lookupRegulation(rawInput.tipoEntidad, rawInput.situacion);

      const leyesAplicables = entry.leyesAplicablesIds
        .map((id) => lawIndex.get(id))
        .filter((l): l is NonNullable<typeof l> => l !== undefined)
        .map((l) => ({
          id: l.id,
          nombre: l.nombre,
          articulosClave: l.articulosClave,
          vigenciaDesde: l.vigenciaDesde,
          vigenciaHasta: l.vigenciaHasta,
          ...(l.url !== undefined ? { url: l.url } : {}),
        }));

      const normativasCMF = entry.normativasCMFIds
        .map((id) => normIndex.get(id))
        .filter((n): n is NonNullable<typeof n> => n !== undefined)
        .map((n) => ({
          id: n.id,
          nombre: n.nombre,
          categoria: n.categoria,
          publicadoEn: n.publicadoEn,
          ...(n.url !== undefined ? { url: n.url } : {}),
        }));

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        tipoEntidad: rawInput.tipoEntidad,
        situacion: rawInput.situacion,
        leyesCount: leyesAplicables.length,
        normsCount: normativasCMF.length,
      });

      const legalRefs = [
        ...leyesAplicables.map((l) => catalogIdFromInternal(l.id)),
        ...normativasCMF.map((n) => catalogIdFromInternal(n.id)),
      ].filter((id): id is string => id !== undefined);

      const reasons =
        legalRefs.length > 0
          ? [
              {
                ruleId: "regulation.applicable_catalog",
                weight: 0,
                message: `Catálogo aplicable a (${rawInput.tipoEntidad}, ${rawInput.situacion}): ${leyesAplicables.length} leyes y ${normativasCMF.length} normativas CMF`,
                fundamento:
                  "Lookup determinístico en regulation-matrix; sin LLM. Citas son auditables vía catálogo legal.",
                legalRefs,
              },
            ]
          : [];

      return {
        score: 0,
        reasons,
        sources: [
          {
            name: "regulation-catalog",
            documentId: "EXT-BCN-LEY-FACIL",
            fetchedAt,
            dataAvailable: true,
          },
        ],
        tipoEntidad: rawInput.tipoEntidad,
        situacion: rawInput.situacion,
        leyesAplicables,
        normativasCMF,
        derechos: [...entry.derechos],
        plazosLegales: [...entry.plazosLegales],
      };
    },
  };
}

export { OutputSchema } from "./schema.js";
