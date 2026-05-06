// Reproduce con la batería real de tools que dispara `evaluate()` con una URL.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL;
const bearer = process.env.MCP_API_KEY;
if (!url || !bearer) {
  console.error("MCP_URL y MCP_API_KEY requeridos");
  process.exit(1);
}

const target = process.argv[2] ?? "https://example.com";
const domain = new URL(target).hostname.replace(/^www\./, "");

const calls = [
  { name: "check_blacklist", arguments: { input: target } },
  { name: "check_whitelist", arguments: { input: target } },
  { name: "analyze_domain", arguments: { url: target } },
  { name: "check_dns_ownership", arguments: { domain } },
  { name: "analyze_business_model", arguments: { url: target } },
  { name: "check_regulator_status", arguments: { rutOrName: target } },
];

async function run(label, mode) {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const client = new Client({ name: "parallel-real", version: "1" });
  await client.connect(transport);

  const t0 = Date.now();
  let results;
  if (mode === "parallel") {
    results = await Promise.allSettled(calls.map((c) => client.callTool(c)));
  } else {
    results = [];
    for (const c of calls) {
      try {
        results.push({ status: "fulfilled", value: await client.callTool(c) });
      } catch (e) {
        results.push({ status: "rejected", reason: e });
      }
    }
  }
  const dt = Date.now() - t0;

  const ok = results.filter((r) => r.status === "fulfilled").length;
  const fail = results.length - ok;
  console.log(`\n[${label}] ${mode.toUpperCase()}  durMs=${dt}  ok=${ok}/${results.length}  fail=${fail}`);
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.log(`  ✗ ${calls[i].name}: ${r.reason?.message ?? r.reason}`);
    } else {
      const text = r.value.content?.[0]?.text ?? "";
      let score = "?";
      try {
        score = JSON.parse(text).score;
      } catch {}
      console.log(`  ✓ ${calls[i].name} (score=${score})`);
    }
  });

  await client.close().catch(() => {});
  await transport.close().catch(() => {});
  return { dt, ok, fail };
}

console.log(`Target: ${target} (${calls.length} tools)`);
const serial = await run("serial", "serial");
const parallel = await run("parallel", "parallel");

console.log(
  `\n=== Resumen ===\nSerial:   ${serial.dt}ms  (ok=${serial.ok}/${calls.length})\nParallel: ${parallel.dt}ms (ok=${parallel.ok}/${calls.length})\nSpeedup:  ${(serial.dt / Math.max(parallel.dt, 1)).toFixed(2)}x`,
);
