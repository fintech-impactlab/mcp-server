// Mide el costo aislado de client.connect(transport) contra el MCP real.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL;
const bearer = process.env.MCP_API_KEY;
if (!url || !bearer) {
  console.error("MCP_URL y MCP_API_KEY requeridos");
  process.exit(1);
}

const N = parseInt(process.argv[2] ?? "10", 10);
const samples = [];

for (let i = 0; i < N; i++) {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const client = new Client({ name: "connect-cost", version: "1" });
  const t0 = Date.now();
  await client.connect(transport);
  const dt = Date.now() - t0;
  samples.push(dt);
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
  process.stdout.write(`${dt} `);
}

samples.sort((a, b) => a - b);
const p50 = samples[Math.floor(N * 0.5)];
const p95 = samples[Math.floor(N * 0.95)];
const min = samples[0];
const max = samples[samples.length - 1];
const avg = Math.round(samples.reduce((a, b) => a + b, 0) / N);

console.log(`\n\nN=${N}  min=${min}  p50=${p50}  avg=${avg}  p95=${p95}  max=${max}`);
