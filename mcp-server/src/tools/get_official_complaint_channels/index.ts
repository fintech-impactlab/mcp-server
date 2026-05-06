import { CHANNELS } from "../../constants/channels.js";
import { lookupChannels, type Situacion } from "../../constants/channels-matrix.js";
import { hashInput, logger } from "../../lib/logging.js";
import type { ToolDefinition } from "../../server/registry.js";
import type { EntityType } from "../check_regulator_status/classifier.js";

import { InputShape, type Output } from "./schema.js";

const TOOL_NAME = "get_official_complaint_channels";

type Input = { tipoEntidad: EntityType; situacion: Situacion };

const channelIndex = new Map(CHANNELS.map((c) => [c.id, c]));

export interface GetOfficialComplaintChannelsDeps {
  now?: () => number;
}

export function createGetOfficialComplaintChannelsTool(
  deps: GetOfficialComplaintChannelsDeps = {},
): ToolDefinition<typeof InputShape, Output> {
  const now = deps.now ?? Date.now;

  return {
    name: TOOL_NAME,
    description:
      "Devuelve los canales oficiales para reclamar/denunciar (CMF, SERNAC, ANCI/CSIRT, PDI, Fiscalía, ARCO+) ordenados por relevancia para una combinación (tipoEntidad, situación). Cada canal incluye campos requeridos, documentación a adjuntar y plazos legales. SERNAC siempre disponible.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const inputHash = hashInput(`${rawInput.tipoEntidad}/${rawInput.situacion}`);

      const ids = lookupChannels(rawInput.tipoEntidad, rawInput.situacion);
      const canales = ids
        .map((id) => channelIndex.get(id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
        .map((c) => ({
          id: c.id,
          nombre: c.nombre,
          organismo: c.organismo,
          urlFormulario: c.urlFormulario,
          camposRequeridos: c.camposRequeridos,
          documentacionRequerida: c.documentacionRequerida,
          plazosLegales: c.plazosLegales,
        }));

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        tipoEntidad: rawInput.tipoEntidad,
        situacion: rawInput.situacion,
        canalesCount: canales.length,
      });

      return {
        score: 0,
        reasons: [],
        sources: [
          {
            name: "channels-catalog",
            fetchedAt,
            dataAvailable: true,
          },
        ],
        tipoEntidad: rawInput.tipoEntidad,
        situacion: rawInput.situacion,
        canales,
      };
    },
  };
}

export { OutputSchema } from "./schema.js";
