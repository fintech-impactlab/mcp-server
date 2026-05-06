import { randomUUID } from "node:crypto";

import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { logger } from "./lib/logging.js";
import { createStorage } from "./lib/storage.js";
import { bootstrapCache } from "./server/bootstrap-cache.js";
import { resolveKeyLoader } from "./server/auth/bootstrap.js";
import { KeyStore } from "./server/auth/key-store.js";
import { requireBearer } from "./server/middleware/auth.js";
import { registerTool } from "./server/registry.js";
import { createAnalyzeBusinessModelTool } from "./tools/analyze_business_model/index.js";
import { createAnalyzeDomainTool } from "./tools/analyze_domain/index.js";
import { createCheckBlacklistTool } from "./tools/check_blacklist/index.js";
import { createCheckDnsOwnershipTool } from "./tools/check_dns_ownership/index.js";
import { createCheckRegulatorStatusTool } from "./tools/check_regulator_status/index.js";
import { createCheckWhitelistTool } from "./tools/check_whitelist/index.js";
import { createExplainLawSimpleTool } from "./tools/explain_law_simple/index.js";
import { createFullEvaluationTool } from "./tools/full_evaluation/index.js";
import { createGetApplicableRegulationTool } from "./tools/get_applicable_regulation/index.js";
import { createGetMarketReferenceRatesTool } from "./tools/get_market_reference_rates/index.js";
import { createGetOfficialComplaintChannelsTool } from "./tools/get_official_complaint_channels/index.js";
import { createVerifyChileanEntityTool } from "./tools/verify_chilean_entity/index.js";

const PORT = Number(process.env.PORT ?? 3001);

async function main(): Promise<void> {
  const storage = createStorage();
  logger.event("server.data_dir", { path: storage.getDataDir() });

  const keyStore = new KeyStore({ loader: resolveKeyLoader() });
  try {
    await keyStore.warm();
  } catch (err) {
    logger.event(
      "server.auth_bootstrap_failed",
      { cause: err instanceof Error ? err.message : String(err) },
      "error",
    );
    process.exit(1);
  }
  logger.event("server.auth_keys_loaded", {});

  const cache = bootstrapCache();

  type Deps = { cache: ReturnType<typeof bootstrapCache>; storage: ReturnType<typeof createStorage> };

  function buildMcpServer(deps: Deps): McpServer {
    const mcp = new McpServer({ name: "fintech-mcp", version: "0.1.0" });

    const ratesTool = createGetMarketReferenceRatesTool({
      cache: deps.cache,
      bceConfig: {
        baseUrl: "https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx",
        credentials: {
          user: process.env.BCE_USER ?? "",
          pass: process.env.BCE_PASS ?? "",
        },
      },
    });
    registerTool(mcp, ratesTool);

    registerTool(
      mcp,
      createExplainLawSimpleTool({
        cache: deps.cache,
        bcnConfig: {
          baseUrl: "https://www.bcn.cl/api-leyfacil/servicio/ObtenerGuiaPublicadaHTML",
        },
      }),
    );

    const blacklistTool = createCheckBlacklistTool({
      cache: deps.cache,
      storage: deps.storage,
      ...(process.env.PHISHTANK_API_KEY
        ? { phishtankConfig: { apiKey: process.env.PHISHTANK_API_KEY } }
        : {}),
      urlhausConfig: {},
    });
    registerTool(mcp, blacklistTool);

    const whitelistTool = createCheckWhitelistTool({
      cache: deps.cache,
      storage: deps.storage,
      fintechileConfig: {},
    });
    registerTool(mcp, whitelistTool);

    const analyzeDomainTool = createAnalyzeDomainTool();
    registerTool(mcp, analyzeDomainTool);

    const checkDnsOwnershipTool = createCheckDnsOwnershipTool();
    registerTool(mcp, checkDnsOwnershipTool);

    const verifyChileanEntityTool = createVerifyChileanEntityTool();
    registerTool(mcp, verifyChileanEntityTool);

    const regulatorStatusTool = createCheckRegulatorStatusTool({
      cache: deps.cache,
      storage: deps.storage,
      fintechileConfig: {},
    });
    registerTool(mcp, regulatorStatusTool);

    const businessModelTool = createAnalyzeBusinessModelTool({
      getRates: async () => {
        try {
          const r = await ratesTool.handler({});
          if (r.rates?.tasaMaximaConvencional !== undefined) {
            return { tasaMaximaConvencionalPct: r.rates.tasaMaximaConvencional };
          }
          return null;
        } catch {
          return null;
        }
      },
    });
    registerTool(mcp, businessModelTool);

    const applicableRegulationTool = createGetApplicableRegulationTool();
    registerTool(mcp, applicableRegulationTool);

    const complaintChannelsTool = createGetOfficialComplaintChannelsTool();
    registerTool(mcp, complaintChannelsTool);

    registerTool(
      mcp,
      createFullEvaluationTool({
        checkBlacklist: (input) => blacklistTool.handler({ input }),
        checkWhitelist: (input) => whitelistTool.handler({ input }),
        analyzeDomain: (url) => analyzeDomainTool.handler({ url }),
        checkDnsOwnership: (domain) => checkDnsOwnershipTool.handler({ domain }),
        verifyChileanEntity: (rut) => verifyChileanEntityTool.handler({ rut }),
        checkRegulatorStatus: (rutOrName) => regulatorStatusTool.handler({ rutOrName }),
        analyzeBusinessModel: (text) => businessModelTool.handler({ text }),
        getApplicableRegulation: (params) => applicableRegulationTool.handler(params),
        getOfficialComplaintChannels: (params) => complaintChannelsTool.handler(params),
      }),
    );

    return mcp;
  }

  // Warmup: validar que el factory no lanza antes de aceptar tráfico.
  buildMcpServer({ cache, storage });
  logger.event("server.tools_ready", { count: 12 });

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", name: "fintech-mcp", version: "0.1.0" });
  });

  // Stateful sessions: el SDK MCP requiere que el state del initialize persista
  // entre POSTs subsiguientes (tools/list, tools/call). Mantenemos una sesión
  // (transport + McpServer dedicado) por sessionId, porque el Protocol del SDK
  // solo admite un transport por instancia de McpServer. La Container App corre
  // con maxReplicas: 1 para que los sessionIds sean stickies (Container Apps
  // consumption no soporta sticky sessions a nivel de ingress). Si se sube
  // maxReplicas, mover este Map a un store compartido (Redis / blob).
  type Session = { transport: StreamableHTTPServerTransport; mcp: McpServer };
  const sessions = new Map<string, Session>();
  const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min de inactividad
  const sessionLastSeen = new Map<string, number>();

  setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [sid, lastSeen] of sessionLastSeen) {
      if (lastSeen < cutoff) {
        const s = sessions.get(sid);
        if (s) {
          void s.transport.close();
        }
        sessions.delete(sid);
        sessionLastSeen.delete(sid);
        logger.event("mcp.session_evicted", { sessionId: sid, reason: "ttl" });
      }
    }
  }, 5 * 60 * 1000).unref();

  async function handleMcpRequest(req: Request, res: Response): Promise<void> {
    try {
      const sessionIdHeader = req.header("mcp-session-id");
      let session = sessionIdHeader ? sessions.get(sessionIdHeader) : undefined;

      if (!session) {
        const mcp = buildMcpServer({ cache, storage });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, { transport, mcp });
            sessionLastSeen.set(sid, Date.now());
            logger.event("mcp.session_opened", { sessionId: sid });
          },
          onsessionclosed: (sid: string) => {
            sessions.delete(sid);
            sessionLastSeen.delete(sid);
            logger.event("mcp.session_closed", { sessionId: sid });
          },
        });
        await mcp.connect(transport);
        session = { transport, mcp };
      } else {
        sessionLastSeen.set(sessionIdHeader!, Date.now());
      }

      await session.transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.event(
        "mcp.request_failed",
        { cause: err instanceof Error ? err.message : String(err) },
        "error",
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  }

  app.post("/mcp", requireBearer(keyStore), handleMcpRequest);
  app.get("/mcp", requireBearer(keyStore), handleMcpRequest);
  app.delete("/mcp", requireBearer(keyStore), handleMcpRequest);

  app.listen(PORT, "0.0.0.0", () => {
    logger.event("server.listening", { port: PORT });
  });
}

main().catch((err) => {
  logger.event(
    "server.fatal",
    { cause: err instanceof Error ? err.message : String(err) },
    "error",
  );
  process.exit(1);
});
