import { hashInput, logger } from "../../lib/logging.js";
import { score, type ScoreResult } from "../../scoring/engine.js";
import type { Facts } from "../../scoring/rules.js";
import type { ToolDefinition } from "../../server/registry.js";

import {
  annualizePct,
  detectaAusenciaInfoLegal,
  detectaEsquemaReferidos,
  detectaLenguajeVago,
  detectaPromesaRentabilidad,
} from "./detectors.js";
import { DISCLAIMER, InputShape, type Output } from "./schema.js";

const TOOL_NAME = "analyze_business_model";

type Input = { text: string };

export interface MarketRates {
  tasaMaximaConvencionalPct: number;
}

export interface AnalyzeBusinessModelDeps {
  /** Inyectable: en producción llama internamente a get_market_reference_rates. */
  getRates?: () => Promise<MarketRates | null>;
  now?: () => number;
}

export function createAnalyzeBusinessModelTool(
  deps: AnalyzeBusinessModelDeps = {},
): ToolDefinition<typeof InputShape, Output> {
  const now = deps.now ?? Date.now;
  const getRates = deps.getRates ?? (async () => null);

  return {
    name: TOOL_NAME,
    description:
      "Analiza un texto de oferta financiera (landing, copy, propuesta) con detectores determinísticos sobre promesas de rentabilidad, estructura de referidos/multinivel, lenguaje vago de urgencia y ausencia de información legal. Cuando detecta promesa con cifra, contrasta contra Tasa Máxima Convencional vigente. Retorna disclaimer obligatorio.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const fetchedAt = new Date(startTime).toISOString();
      const text = rawInput.text;
      const inputHash = hashInput(text);

      const promesa = detectaPromesaRentabilidad(text);
      const referidos = detectaEsquemaReferidos(text);
      const vago = detectaLenguajeVago(text);
      const ausencia = detectaAusenciaInfoLegal(text);

      let tasaMaximaConvencionalPct: number | null = null;
      let ratesAvailable = false;
      try {
        const rates = await getRates();
        if (rates !== null) {
          tasaMaximaConvencionalPct = rates.tasaMaximaConvencionalPct;
          ratesAvailable = true;
        }
      } catch (err) {
        logger.event(
          "tool.error",
          {
            toolName: TOOL_NAME,
            source: "bce-rates",
            message: err instanceof Error ? err.message : String(err),
            retriable: false,
          },
          "error",
        );
      }

      const annualizedPct =
        promesa.detected && promesa.amountPct !== null && promesa.period !== null
          ? annualizePct(promesa.amountPct, promesa.period)
          : null;
      const excedeTMC =
        annualizedPct !== null &&
        tasaMaximaConvencionalPct !== null &&
        annualizedPct > tasaMaximaConvencionalPct;

      const promesaIrreal =
        // Cualquier promesa aspiracional fuerte SIN cifra cuenta como irreal.
        (promesa.detected && promesa.amountPct === null) ||
        // O promesa con cifra que excede TMC vigente.
        excedeTMC ||
        // O promesa de período diario/semanal con cifra > 0 (incompatible con mercado regulado, sin esperar TMC).
        (promesa.detected &&
          promesa.amountPct !== null &&
          (promesa.period === "daily" || promesa.period === "weekly"));

      const facts: Facts = {
        businessModel: {
          ...(promesaIrreal ? { promesaRentabilidadIrreal: true } : {}),
          ...(referidos ? { estructuraReferidos: true } : {}),
          ...(vago.detected ? { lenguajeVago: true } : {}),
          ...(ausencia.detected ? { ausenciaInfoLegal: true } : {}),
        },
      };
      const scored: ScoreResult = score(facts);

      const sources = [
        { name: "deterministic-detectors", fetchedAt, dataAvailable: true },
        { name: "bce-rates", fetchedAt, dataAvailable: ratesAvailable },
      ];

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        flagsCount: [promesaIrreal, referidos, vago.detected, ausencia.detected].filter(Boolean)
          .length,
        ratesAvailable,
      });

      return {
        score: scored.score,
        reasons: [...scored.reasons],
        sources,
        disclaimer: DISCLAIMER,
        flags: {
          promesaRentabilidad: {
            amountPct: promesa.amountPct,
            period: promesa.period,
            annualizedPct,
            tasaMaximaConvencionalPct,
            excedeTMC,
            matches: [...promesa.matches],
          },
          estructuraReferidos: referidos,
          lenguajeVago: { detected: vago.detected, matches: [...vago.matches] },
          ausenciaInfoLegal: {
            detected: ausencia.detected,
            hasRut: ausencia.hasRut,
            hasRazonSocial: ausencia.hasRazonSocial,
            hasDireccion: ausencia.hasDireccion,
          },
        },
      };
    },
  };
}

export { OutputSchema } from "./schema.js";
