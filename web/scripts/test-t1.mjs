// Smoke T1: valida que MCP_URL con y sin /mcp resuelve al mismo endpoint
// usando la misma lógica que getConfig() en lib/mcp-client.ts.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function resolveEndpoint(url) {
  const trimmed = url.replace(/\/+$/, "");
  return /\/mcp$/i.test(trimmed) ? trimmed : `${trimmed}/mcp`;
}

const base = process.env.MCP_URL;
const apiKey = process.env.MCP_API_KEY;
if (!base || !apiKey) {
  console.error("MCP_URL y MCP_API_KEY requeridos");
  process.exit(1);
}

const variants = [
  { label: "sin /mcp", url: base.replace(/\/mcp\/?$/, "") },
  { label: "con /mcp", url: `${base.replace(/\/mcp\/?$/, "")}/mcp` },
  { label: "con /mcp/", url: `${base.replace(/\/mcp\/?$/, "")}/mcp/` },
  { label: "trailing slashes", url: `${base.replace(/\/mcp\/?$/, "")}///` },
];

for (const v of variants) {
  const endpoint = resolveEndpoint(v.url);
  console.log(`\n[${v.label}]`);
  console.log(`  input:    ${v.url}`);
  console.log(`  endpoint: ${endpoint}`);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });
  const client = new Client({ name: "smoke-t1", version: "1" });
  try {
    await client.connect(transport);
    const r = await client.callTool({
      name: "check_blacklist",
      arguments: { input: "https://example.com" },
    });
    const score = JSON.parse(r.content[0].text).score;
    console.log(`  ✓ connected + callTool OK (score=${score})`);
  } catch (err) {
    console.log(`  ✗ FAIL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}
