import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL;
const bearer = process.env.MCP_API_KEY;
if (!url || !bearer) {
  console.error("MCP_URL y MCP_API_KEY requeridos");
  process.exit(1);
}

const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
});
const client = new Client({ name: "verify", version: "1" });

console.log("→ connect()...");
await client.connect(transport);
console.log("✓ connected");

console.log("\n→ callTool check_blacklist({ input: 'https://example.com' })");
const r1 = await client.callTool({
  name: "check_blacklist",
  arguments: { input: "https://example.com" },
});
console.log("response:");
console.log(JSON.stringify(r1, null, 2));

console.log("\n→ callTool analyze_domain({ url: 'https://example.com' })");
const r2 = await client.callTool({
  name: "analyze_domain",
  arguments: { url: "https://example.com" },
});
console.log("response:");
console.log(JSON.stringify(r2, null, 2));

await client.close();
console.log("\n✓ closed");
