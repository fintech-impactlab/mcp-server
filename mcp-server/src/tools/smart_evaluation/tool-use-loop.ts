// Tool-use loop: cuando el classifier devuelve `type: ambiguo`, escalamos a
// Claude con el catálogo de tools como tool definitions y dejamos que decida
// la secuencia. El score y verdict siguen viniendo del motor determinístico
// — el LLM nunca los toca.

import type { AnthropicClientLike, AnthropicMessage } from "../../lib/anthropic.js";
import { ClaudeAPIError } from "../../lib/errors.js";
import { logger } from "../../lib/logging.js";
import type { Source } from "../../lib/schemas.js";
import type { Situacion } from "../../constants/regulation-matrix.js";
import type { Output as FullEvaluationOutput } from "../full_evaluation/schema.js";

import type { ClassifierOutput } from "./classifier.js";
import type { AnthropicToolDef } from "./tool-bridge.js";

const ESCALATE_PROMPT_ID = "escalate";
const ESCALATE_PROMPT_VERSION = "1";

const ESCALATE_SYSTEM = `Eres un asistente de orquestación. Recibes un input ambiguo del usuario
sobre una entidad financiera chilena. Tu trabajo es:

1. Identificar la entidad principal a evaluar.
2. Llamar SECUENCIALMENTE las tools disponibles para reunir hechos
   (blacklist, dominio, RPSF, SII, etc.).
3. Cuando tengas suficientes hechos, responde un texto corto resumiendo
   qué encontraste. NO calcules score ni veredicto; eso lo hace otro
   motor con los hechos reunidos.

Reglas:
- No alucines. Si una tool falla, sigue con las demás.
- Máximo 5 tool calls.
- Si el input no requiere ninguna tool (ej. saludo), responde end_turn
  inmediatamente sin llamar tools.`;

export interface ToolHandlerByName {
  [name: string]: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolUseEscalatorParams {
  anthropic: AnthropicClientLike;
  model: string;
  classification: ClassifierOutput;
  rawInput: { input: string; text?: string; situacion?: Situacion };
  fullEvaluationTool: {
    handler: (input: { input: string; text?: string; situacion?: Situacion }) => Promise<FullEvaluationOutput>;
  };
  /** Tool defs Anthropic + handlers locales. Si vacío, fallback B1 path. */
  anthropicTools?: ReadonlyArray<AnthropicToolDef>;
  toolHandlers?: ToolHandlerByName;
  maxIters?: number;
  maxTotalTokens?: number;
  now?: () => number;
}

export interface ToolUseEscalatorResult {
  fullEvaluation: FullEvaluationOutput;
  trace: ReadonlyArray<{ tool: string; durationMs: number; success: boolean }>;
  stoppedAt?: "iter_cap" | "token_cap" | "end_turn" | "no_tools_configured" | null;
}

export type ToolUseEscalator = (params: ToolUseEscalatorParams) => Promise<ToolUseEscalatorResult>;

const DEFAULT_MAX_ITERS = 5;
const DEFAULT_MAX_TOTAL_TOKENS = 20_000;

export const defaultToolUseEscalator: ToolUseEscalator = async (params) => {
  if (
    params.anthropicTools === undefined ||
    params.toolHandlers === undefined ||
    params.anthropicTools.length === 0
  ) {
    return await delegateToFullEvaluation(params, "no_tools_configured");
  }

  const maxIters = params.maxIters ?? DEFAULT_MAX_ITERS;
  const maxTotalTokens = params.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;
  const trace: Array<{ tool: string; durationMs: number; success: boolean }> = [];
  const accumulatedSources: Source[] = [];
  let totalTokens = 0;
  let stopReason: ToolUseEscalatorResult["stoppedAt"] = null;

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    {
      role: "user",
      content: `Input del usuario: ${params.rawInput.input}\n\nEntidad principal sugerida: ${
        params.classification.details.extractedEntity ?? params.classification.normalized
      }`,
    },
  ];

  for (let iter = 0; iter < maxIters; iter += 1) {
    let response: AnthropicMessage;
    try {
      response = await params.anthropic.messages.create({
        model: params.model,
        max_tokens: 1024,
        system: ESCALATE_SYSTEM,
        messages,
        tools: params.anthropicTools,
      });
    } catch (err) {
      logger.event(
        "tool.error",
        {
          toolName: "smart_evaluation",
          source: "claude-api",
          message: err instanceof Error ? err.message : String(err),
          retriable: err instanceof ClaudeAPIError ? err.retriable : false,
          phase: "tool_use_loop",
        },
        "error",
      );
      stopReason = "end_turn";
      break;
    }
    totalTokens += response.usage.input_tokens + response.usage.output_tokens;
    logger.event("claude.call", {
      toolName: "smart_evaluation",
      promptId: ESCALATE_PROMPT_ID,
      promptVersion: ESCALATE_PROMPT_VERSION,
      model: params.model,
      durationMs: 0,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      success: true,
      retries: 0,
      phase: "tool_use_loop",
      iter,
    });

    if (totalTokens > maxTotalTokens) {
      stopReason = "token_cap";
      break;
    }

    if (response.stop_reason !== "tool_use") {
      stopReason = "end_turn";
      break;
    }

    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const tu = block as { id: string; name: string; input: Record<string, unknown> };
        toolUseBlocks.push({ id: tu.id, name: tu.name, input: tu.input });
      }
    }
    if (toolUseBlocks.length === 0) {
      stopReason = "end_turn";
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }> = [];
    for (const tu of toolUseBlocks) {
      const handler = params.toolHandlers[tu.name];
      const start = Date.now();
      if (handler === undefined) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `tool ${tu.name} no disponible en este servidor`,
          is_error: true,
        });
        trace.push({ tool: tu.name, durationMs: 0, success: false });
        continue;
      }
      try {
        const output = (await handler(tu.input)) as Record<string, unknown>;
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(output),
        });
        trace.push({ tool: tu.name, durationMs: Date.now() - start, success: true });
        if (Array.isArray(output["sources"])) {
          accumulatedSources.push(...(output["sources"] as Source[]));
        }
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: err instanceof Error ? err.message : String(err),
          is_error: true,
        });
        trace.push({ tool: tu.name, durationMs: Date.now() - start, success: false });
      }
    }
    messages.push({ role: "user", content: toolResults });

    if (iter === maxIters - 1) {
      stopReason = "iter_cap";
    }
  }

  // Tras el loop, llamamos full_evaluation para garantizar shape consistente
  // y que el score venga del motor determinístico sobre la entidad extraída.
  const fullEval = await delegateToFullEvaluation(params, stopReason);
  const merged: FullEvaluationOutput = {
    ...fullEval.fullEvaluation,
    sources: mergeSources([...accumulatedSources, ...fullEval.fullEvaluation.sources]),
  };
  return {
    fullEvaluation: merged,
    trace: [...trace, ...fullEval.trace],
    stoppedAt: stopReason,
  };
};

function mergeSources(sources: ReadonlyArray<Source>): Source[] {
  const seen = new Map<string, Source>();
  for (const s of sources) {
    if (!seen.has(s.name)) seen.set(s.name, s);
  }
  return [...seen.values()];
}

async function delegateToFullEvaluation(
  params: ToolUseEscalatorParams,
  reason: ToolUseEscalatorResult["stoppedAt"],
): Promise<ToolUseEscalatorResult> {
  const target =
    params.classification.details.extractedEntity ?? params.classification.normalized;
  const start = Date.now();
  const fullEvaluation = await params.fullEvaluationTool.handler({
    input: target,
    ...(params.rawInput.text !== undefined ? { text: params.rawInput.text } : {}),
    ...(params.rawInput.situacion !== undefined ? { situacion: params.rawInput.situacion } : {}),
  });
  return {
    fullEvaluation,
    trace: [
      {
        tool: "full_evaluation",
        durationMs: Date.now() - start,
        success: true,
      },
    ],
    stoppedAt: reason,
  };
}
