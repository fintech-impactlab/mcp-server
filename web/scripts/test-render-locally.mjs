// Levanta el server de producción local conectado al MCP real.
// Usar: BEARER=$(...) node scripts/test-render-locally.mjs
// Luego abrir http://localhost:3000 en el navegador y reproducir el bug.
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  PORT: "3000",
  HOSTNAME: "0.0.0.0",
  MCP_URL: "https://ca-mcp-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io",
  RECAPTCHA_SECRET_KEY: process.env.RECAPTCHA_SECRET_KEY ?? "",
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: "6LfH9dssAAAAAJ5BRkXaYpiwBBwp2YsITHqUuQfy",
};

if (!env.MCP_API_KEY) {
  console.error("MCP_API_KEY requerida (export BEARER=$(az kv...) y MCP_API_KEY=$BEARER)");
  process.exit(1);
}

const child = spawn("node", [".next/standalone/server.js"], { env, stdio: "inherit" });
process.on("SIGINT", () => child.kill("SIGINT"));
