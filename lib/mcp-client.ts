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
    fetchedAt: z.string().datetime(),
    dataAvailable: z.boolean(),
    staleSince: z.string().datetime().optional(),
  })
  .passthrough();

const FullEvaluationResult = z
  .object({
    score: z.number().int().min(-100).max(100),
    reasons: z.array(Reason),
    sources: z.array(Source),
    disclaimer: z.string().optional(),
    verdict: z.string().optional(),
    stages: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type FullEvaluation = z.infer<typeof FullEvaluationResult>;

const JsonRpcResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z
    .object({
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
          }),
        )
        .optional(),
      isError: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

export type McpClientError = {
  reason:
    | "config_missing"
    | "network"
    | "timeout"
    | "unauthorized"
    | "not_found"
    | "invalid_response"
    | "rpc_error"
    | "tool_error";
  message: string;
};

export type McpResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: McpClientError };

const TIMEOUT_FULL_EVAL_MS = 30_000;
const TIMEOUT_HEALTH_MS = 2_000;

function getConfig(): { url: string; apiKey: string } | null {
  const url = process.env.MCP_URL;
  const apiKey = process.env.MCP_API_KEY;
  if (!url || !apiKey) {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), apiKey };
}

function parseSseEnvelope(body: string): unknown {
  const lines = body.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) {
    throw new Error("SSE response without data lines");
  }
  return JSON.parse(dataLines.join("\n"));
}

async function readJsonRpcEnvelope(res: Response): Promise<unknown> {
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return parseSseEnvelope(text);
  }
  return JSON.parse(text);
}

export async function fullEvaluation(
  input: string,
): Promise<McpResult<FullEvaluation>> {
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
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: {
      name: "full_evaluation",
      arguments: { input },
    },
  });

  let res: Response;
  try {
    res = await fetch(`${cfg.url}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_FULL_EVAL_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    logger.error("web.mcp.network", {
      inputHash,
      durationMs: Date.now() - startedAt,
      timedOut,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: {
        reason: timedOut ? "timeout" : "network",
        message: timedOut
          ? "El MCP no respondió a tiempo (30s)."
          : "No se pudo contactar el MCP.",
      },
    };
  }

  if (res.status === 401 || res.status === 403) {
    logger.error("web.mcp.unauthorized", { inputHash, status: res.status });
    return {
      ok: false,
      error: { reason: "unauthorized", message: "Credenciales del MCP rechazadas" },
    };
  }

  if (res.status === 404) {
    logger.error("web.mcp.not_found", { inputHash });
    return {
      ok: false,
      error: { reason: "not_found", message: "Endpoint MCP no encontrado" },
    };
  }

  let envelope: unknown;
  try {
    envelope = await readJsonRpcEnvelope(res);
  } catch (err) {
    logger.error("web.mcp.invalid_response", {
      inputHash,
      status: res.status,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: { reason: "invalid_response", message: "Respuesta del MCP ilegible" },
    };
  }

  const parsed = JsonRpcResponse.safeParse(envelope);
  if (!parsed.success) {
    logger.error("web.mcp.invalid_response", {
      inputHash,
      issues: parsed.error.issues.slice(0, 3),
    });
    return {
      ok: false,
      error: { reason: "invalid_response", message: "Envelope JSON-RPC inválido" },
    };
  }

  const rpc = parsed.data;
  if (rpc.error) {
    logger.error("web.mcp.rpc_error", {
      inputHash,
      code: rpc.error.code,
      message: rpc.error.message,
    });
    return {
      ok: false,
      error: { reason: "rpc_error", message: rpc.error.message },
    };
  }

  const result = rpc.result;
  const textBlock = result?.content?.find((c) => c.type === "text");
  if (!textBlock?.text) {
    return {
      ok: false,
      error: { reason: "invalid_response", message: "Sin contenido de texto en la respuesta" },
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(textBlock.text);
  } catch {
    return {
      ok: false,
      error: { reason: "invalid_response", message: "Contenido de la tool no es JSON" },
    };
  }

  const data = FullEvaluationResult.safeParse(payload);
  if (!data.success) {
    logger.error("web.mcp.schema_mismatch", {
      inputHash,
      issues: data.error.issues.slice(0, 3),
    });
    return {
      ok: false,
      error: { reason: "invalid_response", message: "La tool devolvió un shape inesperado" },
    };
  }

  if (result?.isError) {
    logger.warn("web.mcp.tool_error", { inputHash });
    return {
      ok: false,
      error: { reason: "tool_error", message: "La tool reportó un error" },
    };
  }

  logger.event("web.evaluate", {
    inputHash,
    durationMs: Date.now() - startedAt,
    score: data.data.score,
    reasonsCount: data.data.reasons.length,
    sourcesCount: data.data.sources.length,
  });

  return { ok: true, data: data.data };
}

export type HealthResult =
  | { ok: true; status: string; name?: string; version?: string }
  | { ok: false; error: string };

export async function health(): Promise<HealthResult> {
  const cfg = getConfig();
  if (!cfg) {
    return { ok: false, error: "config_missing" };
  }
  try {
    const res = await fetch(`${cfg.url}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_HEALTH_MS),
    });
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}` };
    }
    const json = (await res.json()) as { status?: string; name?: string; version?: string };
    return {
      ok: true,
      status: json.status ?? "unknown",
      name: json.name,
      version: json.version,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}
