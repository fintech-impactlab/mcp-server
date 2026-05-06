import Anthropic from "@anthropic-ai/sdk";

import { ClaudeAPIError } from "./errors.js";
import { logger } from "./logging.js";

/** Subset del cliente Anthropic que necesitamos. Permite stubbing en tests. */
export interface AnthropicClientLike {
  messages: {
    create: (params: AnthropicCreateParams) => Promise<AnthropicMessage>;
  };
}

export interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ReadonlyArray<unknown>;
  tools?: ReadonlyArray<unknown>;
  temperature?: number;
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | { type: string };

export interface AnthropicMessage {
  id: string;
  role: "assistant";
  content: ReadonlyArray<AnthropicContentBlock>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export interface CreateAnthropicClientConfig {
  apiKey?: string;
}

export function createAnthropicClient(
  config: CreateAnthropicClientConfig = {},
): AnthropicClientLike {
  const apiKey = config.apiKey ?? process.env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new ClaudeAPIError("ANTHROPIC_API_KEY no está seteado en el entorno", {
      retriable: false,
      userFacing:
        "El servidor no tiene credenciales de Claude configuradas. Contactar al operador.",
    });
  }
  return new Anthropic({ apiKey }) as unknown as AnthropicClientLike;
}

export interface CallClaudeParams {
  client: AnthropicClientLike;
  /** Modelo Anthropic, ej. claude-haiku-4-5-20251001. */
  model: string;
  /** System prompt. */
  system: string;
  /** Mensajes user/assistant. */
  messages: ReadonlyArray<unknown>;
  /** Identifica el prompt para trazabilidad. */
  promptId: string;
  promptVersion: string;
  /** Para logs. */
  toolName: string;
  /** Tool definitions Anthropic (slice 4). */
  tools?: ReadonlyArray<unknown>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Default 3. */
  maxRetries?: number;
  /** Inyectable para tests determinísticos. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ClaudeCallResult {
  /** Concatenación del texto de los TextBlocks. null si la respuesta es solo tool_use. */
  text: string | null;
  /** Bloques tool_use extraídos para el loop de Slice 4. */
  toolUses: ReadonlyArray<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  retries: number;
  raw: AnthropicMessage;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_TOKENS = 1_024;
const DEFAULT_MAX_RETRIES = 3;
const RETRIABLE_NET_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"]);

export async function callClaude(params: CallClaudeParams): Promise<ClaudeCallResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = params.sleep ?? defaultSleep;
  const now = params.now ?? Date.now;
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;

  let lastErr: unknown;
  let retries = 0;
  const startTime = now();

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const createParams: AnthropicCreateParams = {
        model: params.model,
        max_tokens: maxTokens,
        system: params.system,
        messages: params.messages,
        ...(params.tools !== undefined ? { tools: params.tools } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      };
      const response = await params.client.messages.create(createParams);
      const result = interpret(response, retries);
      logger.event("claude.call", {
        toolName: params.toolName,
        promptId: params.promptId,
        promptVersion: params.promptVersion,
        model: params.model,
        durationMs: now() - startTime,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        success: true,
        retries,
      });
      return result;
    } catch (err) {
      lastErr = err;
      const retriable = isRetriable(err);
      if (!retriable || attempt >= maxRetries - 1) break;
      retries += 1;
      await sleep(1_000 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  logger.event(
    "claude.call",
    {
      toolName: params.toolName,
      promptId: params.promptId,
      promptVersion: params.promptVersion,
      model: params.model,
      durationMs: now() - startTime,
      success: false,
      retries,
      message: lastErr instanceof Error ? lastErr.message : String(lastErr),
    },
    "error",
  );

  if (lastErr instanceof ClaudeAPIError) throw lastErr;
  throw new ClaudeAPIError("Solicitud a Claude falló tras reintentos", {
    cause: lastErr,
    retriable: isRetriable(lastErr),
  });
}

function interpret(response: AnthropicMessage, retries: number): ClaudeCallResult {
  const textParts: string[] = [];
  const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  for (const block of response.content) {
    if (block.type === "text" && typeof (block as AnthropicTextBlock).text === "string") {
      textParts.push((block as AnthropicTextBlock).text);
    } else if (block.type === "tool_use") {
      const tu = block as AnthropicToolUseBlock;
      toolUses.push({ id: tu.id, name: tu.name, input: tu.input });
    }
  }
  const text = textParts.length > 0 ? textParts.join("\n") : null;
  return {
    text,
    toolUses,
    stopReason: response.stop_reason,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    retries,
    raw: response,
  };
}

function isRetriable(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && RETRIABLE_NET_CODES.has(code)) return true;
    // SDK Anthropic levanta APIError con status numérico.
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") {
      if (status === 429) return false; // respetar rate-limit
      if (status >= 500) return true;
      return false;
    }
  }
  return false;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
