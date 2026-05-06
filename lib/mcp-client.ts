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

const TIMEOUT_MS = 30_000;

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

function getConfig(): { url: string; apiKey: string } | null {
  const url = process.env.MCP_URL;
  const apiKey = process.env.MCP_API_KEY;
  if (!url || !apiKey) return null;
  return { url: url.replace(/\/+$/, ""), apiKey };
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

function normalizeUrl(input: string): string {
  try {
    return new URL(input).toString();
  } catch {
    return new URL(`https://${input}`).toString();
  }
}

function pickToolCalls(input: string): Array<{ tool: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
  calls.push({ tool: "check_blacklist", arguments: { input } });
  if (looksLikeUrl(input)) {
    calls.push({ tool: "analyze_domain", arguments: { url: normalizeUrl(input) } });
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
  const transport = new StreamableHTTPClientTransport(new URL(`${cfg.url}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    },
  });
  const client = new Client({ name: "fintech-web", version: "0.1.0" });

  const closeQuietly = async (): Promise<void> => {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  };

  try {
    await client.connect(transport);
  } catch (err) {
    await closeQuietly();
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

  const calls = pickToolCalls(input);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const outcomes: ToolOutcome[] = [];

  try {
    for (const { tool, arguments: args } of calls) {
      const stage = TOOL_STAGES[tool] ?? "otro";
      try {
        const result = await client.callTool(
          { name: tool, arguments: args },
          undefined,
          { signal },
        );
        const payload = extractToolPayload(
          result as {
            content?: Array<{ type: string; text?: string }>;
            structuredContent?: unknown;
            isError?: boolean;
          },
        );
        if (!payload.ok) {
          outcomes.push({ tool, stage, ok: false, error: payload.error });
          continue;
        }
        outcomes.push({ tool, stage, ok: true, data: payload.data });
      } catch (err) {
        const isTimeout =
          err && typeof err === "object" && "name" in err && (err as { name: string }).name === "TimeoutError";
        outcomes.push({
          tool,
          stage,
          ok: false,
          error: isTimeout ? "timeout" : err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await closeQuietly();
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
            ? "El MCP no respondió a tiempo (30s)."
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
