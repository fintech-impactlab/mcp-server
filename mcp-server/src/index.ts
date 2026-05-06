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
import { createAnalyzeDomainTool } from "./tools/analyze_domain/index.js";
import { createCheckBlacklistTool } from "./tools/check_blacklist/index.js";
import { createCheckDnsOwnershipTool } from "./tools/check_dns_ownership/index.js";
import { createCheckWhitelistTool } from "./tools/check_whitelist/index.js";
import { createExplainLawSimpleTool } from "./tools/explain_law_simple/index.js";
import { createGetMarketReferenceRatesTool } from "./tools/get_market_reference_rates/index.js";

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

  const mcp = new McpServer({
    name: "fintech-mcp",
    version: "0.1.0",
  });

  const cache = bootstrapCache();
  registerTool(
    mcp,
    createGetMarketReferenceRatesTool({
      cache,
      bceConfig: {
        baseUrl: "https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx",
        credentials: {
          user: process.env.BCE_USER ?? "",
          pass: process.env.BCE_PASS ?? "",
        },
      },
    }),
  );
  logger.event("server.tool_registered", { toolName: "get_market_reference_rates" });

  registerTool(
    mcp,
    createExplainLawSimpleTool({
      cache,
      bcnConfig: {
        baseUrl: "https://www.bcn.cl/api-leyfacil/servicio/ObtenerGuiaPublicadaHTML",
      },
    }),
  );
  logger.event("server.tool_registered", { toolName: "explain_law_simple" });

  registerTool(
    mcp,
    createCheckBlacklistTool({
      cache,
      storage,
      ...(process.env.PHISHTANK_API_KEY
        ? { phishtankConfig: { apiKey: process.env.PHISHTANK_API_KEY } }
        : {}),
      urlhausConfig: {},
    }),
  );
  logger.event("server.tool_registered", { toolName: "check_blacklist" });

  registerTool(
    mcp,
    createCheckWhitelistTool({
      cache,
      storage,
      fintechileConfig: {},
    }),
  );
  logger.event("server.tool_registered", { toolName: "check_whitelist" });

  registerTool(mcp, createAnalyzeDomainTool());
  logger.event("server.tool_registered", { toolName: "analyze_domain" });

  registerTool(mcp, createCheckDnsOwnershipTool());
  logger.event("server.tool_registered", { toolName: "check_dns_ownership" });

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", name: "fintech-mcp", version: "0.1.0" });
  });

  app.post("/mcp", requireBearer(keyStore), async (req: Request, res: Response) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
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
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless mode)" },
      id: null,
    });
  });

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
