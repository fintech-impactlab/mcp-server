import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { logger, hashInput } from "./logger";

const Reason = z
  .object({
    ruleId: z.string(),
    weight: z.number().int(),
    message: z.string(),
    fundamento: z.string(),
  })
  .passthrough();

const Source = z
  .object({
    name: z.string(),
    url: z.string().url().optional(),
    fetchedAt: z.string(),
    dataAvailable: z.boolean(),
    staleSince: z.string().optional(),
  })
  .passthrough();

const StageBreakdown = z
  .object({
    stage: z.string(),
    toolsRun: z.array(z.string()).default([]),
    partialScore: z.number().int(),
    reasons: z.array(Reason).default([]),
  })
  .passthrough();

const Recommendation = z
  .object({
    id: z.string(),
    nombre: z.string(),
    organismo: z.string(),
    urlFormulario: z.string().optional(),
    camposRequeridos: z.array(z.string()).default([]),
    documentacionRequerida: z.array(z.string()).default([]),
    plazosLegales: z.array(z.string()).default([]),
  })
  .passthrough();

const FullEvaluationResponse = z
  .object({
    totalScore: z.number().int(),
    verdict: z.string(),
    confianza: z.number(),
    stoppedAt: z.string().nullable().optional(),
    shortCircuitReason: z.string().nullable().optional(),
    reasons: z.array(Reason).default([]),
    sources: z.array(Source).default([]),
    breakdown: z.array(StageBreakdown).default([]),
    tipoEntidad: z.string().optional(),
    situacion: z.string().optional(),
    recomendaciones: z.array(Recommendation).default([]),
    disclaimer: z.string().optional(),
  })
  .passthrough();

export type Reason = z.infer<typeof Reason>;
export type Source = z.infer<typeof Source>;
export type StageBreakdown = z.infer<typeof StageBreakdown>;
export type Recommendation = z.infer<typeof Recommendation>;
export type EvaluationResult = z.infer<typeof FullEvaluationResponse> & { input: string };

export type McpClientError = {
  reason:
    | "config_missing"
    | "connect_failed"
    | "timeout"
    | "evaluation_failed"
    | "invalid_response";
  message: string;
};

export type McpResult<T> = { ok: true; data: T } | { ok: false; error: McpClientError };

const TIMEOUT_PER_CALL_MS = 15_000;
const RETRY_BACKOFF_MS = 250;
const RETRY_MAX_ATTEMPTS = 1;

const POOL_MAX_USES = 50;
const POOL_MAX_AGE_MS = 5 * 60_000;

type PoolEntry = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  createdAt: number;
  uses: number;
  alive: boolean;
};

const POOL_KEY = "__mcpPool__" as const;
type PoolGlobal = typeof globalThis & { [POOL_KEY]?: PoolEntry[] };

function getPool(): PoolEntry[] {
  const g = globalThis as PoolGlobal;
  if (!g[POOL_KEY]) g[POOL_KEY] = [];
  return g[POOL_KEY]!;
}

function poolEnabled(): boolean {
  if (process.env.MCP_POOL === "0") return false;
  if (process.env.MCP_POOL === "1") return true;
  return process.env.NODE_ENV === "production";
}

function isStale(entry: PoolEntry): boolean {
  return (
    !entry.alive ||
    entry.uses >= POOL_MAX_USES ||
    Date.now() - entry.createdAt > POOL_MAX_AGE_MS
  );
}

async function disposeEntry(entry: PoolEntry): Promise<void> {
  entry.alive = false;
  await entry.client.close().catch((err: unknown) => {
    logger.warn("web.mcp.close_failed", {
      stage: "client",
      message: err instanceof Error ? err.message : String(err),
    });
  });
  await entry.transport.close().catch((err: unknown) => {
    logger.warn("web.mcp.close_failed", {
      stage: "transport",
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

async function createEntry(cfg: { endpoint: string; apiKey: string }): Promise<PoolEntry> {
  const transport = new StreamableHTTPClientTransport(new URL(cfg.endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${cfg.apiKey}` } },
  });
  const client = new Client({ name: "fintech-web", version: "0.1.0" });
  await client.connect(transport);
  return { client, transport, createdAt: Date.now(), uses: 0, alive: true };
}

async function acquireSession(cfg: { endpoint: string; apiKey: string }): Promise<{
  entry: PoolEntry;
  pooled: boolean;
}> {
  if (!poolEnabled()) {
    const entry = await createEntry(cfg);
    return { entry, pooled: false };
  }
  const pool = getPool();
  for (let i = pool.length - 1; i >= 0; i--) {
    if (isStale(pool[i])) {
      const stale = pool.splice(i, 1)[0];
      void disposeEntry(stale);
    }
  }
  if (pool.length > 0) {
    return { entry: pool[0], pooled: true };
  }
  const entry = await createEntry(cfg);
  pool.push(entry);
  logger.event("web.mcp.pool_create", { size: pool.length });
  return { entry, pooled: true };
}

async function releaseSession(
  entry: PoolEntry,
  pooled: boolean,
  failed: boolean,
): Promise<void> {
  entry.uses += 1;
  if (!pooled) {
    await disposeEntry(entry);
    return;
  }
  if (failed) {
    entry.alive = false;
  }
  if (isStale(entry)) {
    const pool = getPool();
    const idx = pool.indexOf(entry);
    if (idx >= 0) pool.splice(idx, 1);
    await disposeEntry(entry);
    logger.event("web.mcp.pool_evict", {
      size: pool.length,
      reason: !entry.alive ? "failed_or_dead" : entry.uses >= POOL_MAX_USES ? "max_uses" : "max_age",
    });
  }
}

function isTimeoutError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: string }).name === "TimeoutError"
  );
}

function isTransient(err: unknown): boolean {
  if (isTimeoutError(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network/i.test(
    msg,
  );
}

async function callToolWithRetry(
  client: Client,
  call: { name: string; arguments: Record<string, unknown> },
  inputHash: string,
): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      logger.warn("web.mcp.retry", {
        inputHash,
        tool: call.name,
        attempt,
        previousError: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
    const signal = AbortSignal.timeout(TIMEOUT_PER_CALL_MS);
    try {
      return await client.callTool(
        { name: call.name, arguments: call.arguments },
        undefined,
        { signal },
      );
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) throw err;
    }
  }
  throw lastErr;
}

function getConfig(): { endpoint: string; apiKey: string } | null {
  const url = process.env.MCP_URL;
  const apiKey = process.env.MCP_API_KEY;
  if (!url || !apiKey) return null;
  const trimmed = url.replace(/\/+$/, "");
  const endpoint = /\/mcp$/i.test(trimmed) ? trimmed : `${trimmed}/mcp`;
  return { endpoint, apiKey };
}

function parseToolResult(result: {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}): { ok: true; data: z.infer<typeof FullEvaluationResponse> } | { ok: false; error: McpClientError } {
  if (result.isError) {
    return {
      ok: false,
      error: { reason: "evaluation_failed", message: "El MCP devolvió un error en la evaluación." },
    };
  }
  let payload: unknown = result.structuredContent;
  if (payload === undefined) {
    const text = result.content?.find((c) => c.type === "text")?.text;
    if (!text) {
      return {
        ok: false,
        error: { reason: "invalid_response", message: "Respuesta sin contenido." },
      };
    }
    try {
      payload = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: { reason: "invalid_response", message: "El contenido no es JSON válido." },
      };
    }
  }
  const parsed = FullEvaluationResponse.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: { reason: "invalid_response", message: "Shape inesperado en la respuesta." },
    };
  }
  return { ok: true, data: parsed.data };
}

export async function evaluate(input: string): Promise<McpResult<EvaluationResult>> {
  const cfg = getConfig();
  const inputHash = hashInput(input);
  if (!cfg) {
    logger.error("web.mcp.config_missing", { inputHash });
    return {
      ok: false,
      error: { reason: "config_missing", message: "MCP_URL o MCP_API_KEY no configurados" },
    };
  }

  const startedAt = Date.now();
  let session: { entry: PoolEntry; pooled: boolean };
  try {
    session = await acquireSession(cfg);
  } catch (err) {
    logger.error("web.mcp.connect_failed", {
      inputHash,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: { reason: "connect_failed", message: "No se pudo establecer la sesión MCP." },
    };
  }

  const { entry, pooled } = session;
  let sessionFailed = false;

  try {
    let raw: unknown;
    try {
      raw = await callToolWithRetry(
        entry.client,
        { name: "full_evaluation", arguments: { input } },
        inputHash,
      );
    } catch (err) {
      if (isTransient(err)) sessionFailed = true;
      const reason = isTimeoutError(err) ? "timeout" : "evaluation_failed";
      const message = isTimeoutError(err)
        ? `El MCP no respondió a tiempo (${TIMEOUT_PER_CALL_MS / 1000}s).`
        : err instanceof Error
          ? err.message
          : String(err);
      logger.error("web.mcp.evaluation_failed", {
        inputHash,
        durationMs: Date.now() - startedAt,
        reason,
        message,
      });
      return { ok: false, error: { reason, message } };
    }

    const parsed = parseToolResult(
      raw as {
        content?: Array<{ type: string; text?: string }>;
        structuredContent?: unknown;
        isError?: boolean;
      },
    );
    if (!parsed.ok) {
      logger.error("web.mcp.evaluation_failed", {
        inputHash,
        durationMs: Date.now() - startedAt,
        reason: parsed.error.reason,
        message: parsed.error.message,
      });
      return parsed;
    }

    const data: EvaluationResult = { input, ...parsed.data };

    logger.event("web.evaluate", {
      inputHash,
      durationMs: Date.now() - startedAt,
      totalScore: data.totalScore,
      verdict: data.verdict,
      confianza: data.confianza,
      stoppedAt: data.stoppedAt ?? null,
    });

    return { ok: true, data };
  } finally {
    await releaseSession(entry, pooled, sessionFailed);
  }
}
