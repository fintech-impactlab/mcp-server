import { hashInput, logger } from "../../lib/logging.js";
import type { AnthropicClientLike } from "../../lib/anthropic.js";
import type { ToolDefinition } from "../../server/registry.js";
import type { Situacion } from "../../constants/regulation-matrix.js";

import type { Output as FullEvaluationOutput } from "../full_evaluation/schema.js";

import { classifyInput, type ClassifyDeps } from "./classifier.js";
import {
  type ToolUseEscalator,
  defaultToolUseEscalator,
} from "./tool-use-loop.js";
import { InputShape, type Output } from "./schema.js";

const TOOL_NAME = "smart_evaluation";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

type Input = { input: string; text?: string; situacion?: Situacion };

export interface SmartEvaluationDeps {
  anthropic: AnthropicClientLike;
  /** Modelo por defecto: claude-haiku-4-5-20251001. */
  model?: string;
  /** Tool full_evaluation inyectada para el path B1 (input simple). */
  fullEvaluationTool: {
    handler: (input: { input: string; text?: string; situacion?: Situacion }) => Promise<FullEvaluationOutput>;
  };
  /** Para path B3 (input ambiguo). Default: stub que delega al full_evaluation. */
  toolUseEscalator?: ToolUseEscalator;
  /** Helpers de classifier (ver classifier.ts). */
  classifierExtras?: Partial<Pick<ClassifyDeps, "expandUrlConfig" | "fallbackClassifier" | "sleep">>;
  now?: () => number;
}

export function createSmartEvaluationTool(
  deps: SmartEvaluationDeps,
): ToolDefinition<typeof InputShape, Output> {
  const now = deps.now ?? Date.now;
  const model = deps.model ?? DEFAULT_MODEL;
  const escalator = deps.toolUseEscalator ?? defaultToolUseEscalator;

  return {
    name: TOOL_NAME,
    description:
      "Orquestador con LLM (Claude Haiku) que pre-clasifica inputs ambiguos (URL corta, sin protocolo, RUT mal formateado, lenguaje natural) y delega al motor determinístico de tools. El score y verdict siempre vienen del engine de reglas — el LLM nunca los toca. Si la API de Claude cae, fallback a clasificador determinístico.",
    inputSchema: InputShape,
    handler: async (rawInput: Input): Promise<Output> => {
      const startTime = now();
      const inputHash = hashInput(rawInput.input);

      const classification = await classifyInput(rawInput.input, {
        anthropic: deps.anthropic,
        model,
        ...(deps.classifierExtras?.expandUrlConfig !== undefined
          ? { expandUrlConfig: deps.classifierExtras.expandUrlConfig }
          : {}),
        ...(deps.classifierExtras?.fallbackClassifier !== undefined
          ? { fallbackClassifier: deps.classifierExtras.fallbackClassifier }
          : {}),
        ...(deps.classifierExtras?.sleep !== undefined
          ? { sleep: deps.classifierExtras.sleep }
          : {}),
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      });

      let routedTo: Output["routedTo"];
      let fullEvalOutput: FullEvaluationOutput;
      let toolUseTrace: Array<{ tool: string; durationMs: number; success: boolean }> = [];

      if (classification.type === "ambiguo") {
        routedTo = "tool_use_loop";
        const escalated = await escalator({
          anthropic: deps.anthropic,
          model,
          classification,
          rawInput,
          fullEvaluationTool: deps.fullEvaluationTool,
        });
        fullEvalOutput = escalated.fullEvaluation;
        toolUseTrace = [...escalated.trace];
      } else {
        routedTo = "full_evaluation";
        fullEvalOutput = await deps.fullEvaluationTool.handler({
          input: classification.normalized,
          ...(rawInput.text !== undefined ? { text: rawInput.text } : {}),
          ...(rawInput.situacion !== undefined ? { situacion: rawInput.situacion } : {}),
        });
      }

      logger.event("tool.call", {
        toolName: TOOL_NAME,
        inputHash,
        durationMs: now() - startTime,
        success: true,
        classificationType: classification.type,
        classifierSource: classification.classifierSource,
        routedTo,
        verdict: fullEvalOutput.verdict,
      });

      return {
        ...fullEvalOutput,
        classification,
        toolUseTrace,
        routedTo,
      };
    },
  };
}

export { OutputSchema } from "./schema.js";
