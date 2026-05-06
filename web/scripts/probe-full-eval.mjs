import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL;
const bearer = process.env.MCP_API_KEY;
const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
});
const client = new Client({ name: "probe", version: "1" });
await client.connect(transport);

const inputs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["https://www.bancochile.cl", "76.001.001-1", "fintech ejemplo"];

for (const input of inputs) {
  console.log(`\n=== ${input} ===`);
  const t0 = Date.now();
  const r = await client.callTool({ name: "full_evaluation", arguments: { input } });
  const dt = Date.now() - t0;
  console.log(`durMs=${dt}`);
  console.log("isError:", r.isError);
  console.log("structuredContent keys:", r.structuredContent ? Object.keys(r.structuredContent) : "n/a");
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (text) {
    try {
      const obj = JSON.parse(text);
      console.log("parsed:", JSON.stringify(obj, null, 2).slice(0, 3000));
    } catch {
      console.log("text:", text.slice(0, 500));
    }
  }
}
await client.close();
await transport.close();
