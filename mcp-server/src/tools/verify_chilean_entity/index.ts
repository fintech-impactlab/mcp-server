import { DequienesError, SIIError } from "../../lib/errors.js";
import { hashInput, logger } from "../../lib/logging.js";
import { score, type ScoreResult } from "../../scoring/engine.js";
import type { Facts } from "../../scoring/rules.js";
import type { ToolDefinition } from "../../server/registry.js";

import * as dequienes from "./clients/dequienes.js";
import * as sii from "./clients/sii.js";
import { InputShape, monthsBetween, type Output } from "./schema.js";

const TOOL_NAME = "verify_chilean_entity";

type Input = { rut: string };

export interface VerifyChileanEntityDeps {
  siiConfig?: sii.SiiConfig;
  dequienesConfig?: dequienes.DequienesConfig;
  now?: () => number;
}

export function createVerifyChileanEntityTool(
  deps: VerifyChileanEntityDeps = {},
): ToolDefinition<typeof InputShape, Output> {
  const now = deps.now ?? Date.now;

  return {
    name: TOOL_NAME,
    description:
      "Verifica una persona jurídica chilena por RUT: situación tributaria en el SII (estado, inicio de actividades, giros) y socios/representantes públicos en dequienes.cl. Retorna score parcial con razones determinísticas; cada fuente reporta dataAvailable independiente.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const rut = rawInput.rut.trim();
      const inputHash = hashInput(rut);

      const siiResult = await runSii(rut, deps.siiConfig);
      const dequienesResult = await runDequienes(rut, deps.dequienesConfig);

      const ageMonths =
        siiResult.dataAvailable && siiResult.fechaInicio !== null
          ? monthsBetween(siiResult.fechaInicio, startTime)
          : null;

      const facts: Facts = {
        entity: {
          ...(siiResult.dataAvailable && siiResult.estado !== "desconocido"
            ? { siiStatus: siiResult.estado as "activo" | "suspendido" | "sin_inicio" }
            : {}),
          ...(ageMonths !== null ? { ageMonths } : {}),
        },
      };
      const scored: ScoreResult = score(facts);

      const sources = [
        {
          name: "sii",
          fetchedAt,
          dataAvailable: siiResult.dataAvailable,
        },
        {
          name: "dequienes",
          fetchedAt,
          dataAvailable: dequienesResult.dataAvailable,
        },
      ];

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        sourcesQueried: 2,
        sourcesFailed: countFailed([siiResult, dequienesResult]),
      });

      return {
        score: scored.score,
        reasons: [...scored.reasons],
        sources,
        rut,
        razonSocial: siiResult.razonSocial ?? dequienesResult.razonSocial,
        siiStatus: siiResult.dataAvailable ? siiResult.estado : "desconocido",
        inicioActividades: siiResult.dataAvailable ? siiResult.inicioActividades : false,
        fechaInicio: siiResult.fechaInicio,
        ageMonths,
        giros: [...siiResult.giros],
        socios: [...dequienesResult.socios],
        representantes: [...dequienesResult.representantes],
      };
    },
  };
}

interface SiiCheckResult {
  dataAvailable: boolean;
  estado: sii.SiiEstado;
  inicioActividades: boolean;
  fechaInicio: string | null;
  razonSocial: string | null;
  giros: ReadonlyArray<sii.SiiGiro>;
}

async function runSii(rut: string, config: sii.SiiConfig | undefined): Promise<SiiCheckResult> {
  try {
    const result = await sii.fetchSiiSituation(rut, config ?? {});
    return {
      dataAvailable: result.found,
      estado: result.estado,
      inicioActividades: result.inicioActividades,
      fechaInicio: result.fechaInicio,
      razonSocial: result.razonSocial,
      giros: result.giros,
    };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "sii",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof SIIError ? err.retriable : false,
      },
      "error",
    );
    return {
      dataAvailable: false,
      estado: "desconocido",
      inicioActividades: false,
      fechaInicio: null,
      razonSocial: null,
      giros: [],
    };
  }
}

interface DequienesCheckResult {
  dataAvailable: boolean;
  razonSocial: string | null;
  socios: ReadonlyArray<dequienes.DequienesPerson>;
  representantes: ReadonlyArray<dequienes.DequienesPerson>;
}

async function runDequienes(
  rut: string,
  config: dequienes.DequienesConfig | undefined,
): Promise<DequienesCheckResult> {
  try {
    const result = await dequienes.fetchDequienes(rut, config ?? {});
    return {
      dataAvailable: result.found,
      razonSocial: result.razonSocial,
      socios: result.socios,
      representantes: result.representantes,
    };
  } catch (err) {
    logger.event(
      "tool.error",
      {
        toolName: TOOL_NAME,
        source: "dequienes",
        message: err instanceof Error ? err.message : String(err),
        retriable: err instanceof DequienesError ? err.retriable : false,
      },
      "error",
    );
    return {
      dataAvailable: false,
      razonSocial: null,
      socios: [],
      representantes: [],
    };
  }
}

function countFailed(results: ReadonlyArray<{ dataAvailable: boolean }>): number {
  return results.filter((r) => !r.dataAvailable).length;
}

export { OutputSchema } from "./schema.js";
