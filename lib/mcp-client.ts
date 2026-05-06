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

const BaseToolResponse = z
  .object({
    score: z.number().int(),
    reasons: z.array(Reason).default([]),
    sources: z.array(Source).default([]),
    disclaimer: z.string().optional(),
    verdict: z.string().optional(),
  })
  .passthrough();

export type ToolResponse = z.infer<typeof BaseToolResponse>;

export type ToolOutcome = {
  tool: string;
  stage: string;
  ok: boolean;
  data?: ToolResponse;
  error?: string;
};

export type EvaluationResult = {
  input: string;
  scoreTotal: number;
  outcomes: ToolOutcome[];
};

export type McpClientError = {
  reason:
    | "config_missing"
    | "connect_failed"
    | "timeout"
    | "all_tools_failed";
  message: string;
};

export type McpResult<T> = { ok: true; data: T } | { ok: false; error: McpClientError };

const TIMEOUT_PER_CALL_MS = 12_000;
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

// Pool persistente entre requests (singleton vía globalThis para sobrevivir a HMR
// y a la inicialización por archivo en producción).
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

const TOOL_STAGES: Record<string, string> = {
  check_blacklist: "screening",
  check_whitelist: "screening",
  analyze_domain: "tecnico",
  check_dns_ownership: "tecnico",
  verify_chilean_entity: "entidad",
  check_regulator_status: "entidad",
  analyze_business_model: "entidad",
  full_evaluation: "consolidado",
};

function getConfig(): { endpoint: string; apiKey: string } | null {
  const url = process.env.MCP_URL;
  const apiKey = process.env.MCP_API_KEY;
  if (!url || !apiKey) return null;
  const trimmed = url.replace(/\/+$/, "");
  const endpoint = /\/mcp$/i.test(trimmed) ? trimmed : `${trimmed}/mcp`;
  return { endpoint, apiKey };
}

function looksLikeUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(input)) {
      try {
        new URL(`https://${input}`);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

function looksLikeRut(input: string): boolean {
  return /^\d{1,2}(\.\d{3}){0,2}-[\dkK]$/.test(input.replace(/\s+/g, ""));
}

function normalizeUrl(input: string): string {
  try {
    return new URL(input).toString();
  } catch {
    return new URL(`https://${input}`).toString();
  }
}

function pickToolCalls(input: string): Array<{ tool: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
  const isUrl = looksLikeUrl(input);
  const isRut = looksLikeRut(input);

  // Etapa 1 — screening
  calls.push({ tool: "check_blacklist", arguments: { input } });
  calls.push({ tool: "check_whitelist", arguments: { input } });

  if (isUrl) {
    const url = normalizeUrl(input);
    const domain = new URL(url).hostname.replace(/^www\./, "");
    // Etapa 2 — análisis técnico
    calls.push({ tool: "analyze_domain", arguments: { url } });
    calls.push({ tool: "check_dns_ownership", arguments: { domain } });
    // Etapa 3 — análisis del negocio
    calls.push({ tool: "analyze_business_model", arguments: { url } });
  }

  if (isRut) {
    // Etapa 3 — entidad chilena
    calls.push({ tool: "verify_chilean_entity", arguments: { rut: input } });
    calls.push({ tool: "check_regulator_status", arguments: { rutOrName: input } });
  } else if (!isUrl) {
    // Nombre de empresa → check regulator por nombre
    calls.push({ tool: "check_regulator_status", arguments: { rutOrName: input } });
  }

  return calls;
}

function extractToolPayload(result: {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}): { ok: true; data: ToolResponse } | { ok: false; error: string } {
  if (result.isError) {
    return { ok: false, error: "tool reportó error" };
  }
  if (result.structuredContent !== undefined) {
    const parsed = BaseToolResponse.safeParse(result.structuredContent);
    if (parsed.success) return { ok: true, data: parsed.data };
  }
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) return { ok: false, error: "respuesta sin contenido" };
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, error: "contenido no es JSON" };
  }
  const parsed = BaseToolResponse.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: "shape inesperado" };
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
      error: {
        reason: "connect_failed",
        message: "No se pudo establecer la sesión MCP.",
      },
    };
  }

  const { entry, pooled } = session;
  const calls = pickToolCalls(input);
  let outcomes: ToolOutcome[] = [];
  let sessionFailed = false;

  try {
    outcomes = await Promise.all(
      calls.map(async ({ tool, arguments: args }): Promise<ToolOutcome> => {
        const stage = TOOL_STAGES[tool] ?? "otro";
        try {
          const result = await callToolWithRetry(
            entry.client,
            { name: tool, arguments: args },
            inputHash,
          );
          const payload = extractToolPayload(
            result as {
              content?: Array<{ type: string; text?: string }>;
              structuredContent?: unknown;
              isError?: boolean;
            },
          );
          if (!payload.ok) {
            return { tool, stage, ok: false, error: payload.error };
          }
          return { tool, stage, ok: true, data: payload.data };
        } catch (err) {
          if (isTransient(err)) sessionFailed = true;
          return {
            tool,
            stage,
            ok: false,
            error: isTimeoutError(err) ? "timeout" : err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
  } finally {
    await releaseSession(entry, pooled, sessionFailed);
  }

  const okCount = outcomes.filter((o) => o.ok).length;
  if (okCount === 0) {
    logger.error("web.mcp.all_tools_failed", {
      inputHash,
      durationMs: Date.now() - startedAt,
      tools: outcomes.map((o) => ({ tool: o.tool, error: o.error })),
    });
    const firstError = outcomes[0]?.error ?? "unknown";
    return {
      ok: false,
      error: {
        reason: firstError === "timeout" ? "timeout" : "all_tools_failed",
        message:
          firstError === "timeout"
            ? `El MCP no respondió a tiempo (${TIMEOUT_PER_CALL_MS / 1000}s).`
            : `No se pudo completar ninguna verificación: ${firstError}`,
      },
    };
  }

  const scoreTotal = outcomes.reduce((acc, o) => acc + (o.data?.score ?? 0), 0);

  logger.event("web.evaluate", {
    inputHash,
    durationMs: Date.now() - startedAt,
    scoreTotal,
    okCount,
    failed: outcomes.filter((o) => !o.ok).map((o) => o.tool),
  });

  return {
    ok: true,
    data: { input, scoreTotal, outcomes },
  };
}
