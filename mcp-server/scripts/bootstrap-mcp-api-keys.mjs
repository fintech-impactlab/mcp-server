#!/usr/bin/env node
// Bootstrap del Slice A2 de tasks/todo-auth.md (A2.1 + A2.4).
//
// Genera plaintexts URL-safe para clientIds "web" y "dev", calcula sus hashes,
// y persiste DOS secrets en el Azure Key Vault indicado:
//
//   - mcp-api-keys      → JSON array con los hashes (consumido por ca-mcp).
//   - mcp-api-key-web   → plaintext del clientId "web" (consumido por ca-web).
//
// Imprime los plaintexts UNA SOLA VEZ por stdout. Después no son recuperables.
//
// Uso:
//   node scripts/bootstrap-mcp-api-keys.mjs --vault <kv-name>
//
// Requisitos:
//   - `az` CLI instalada y `az login` completado.
//   - El usuario que corre el script debe tener Key Vault Secrets Officer
//     (o equivalente) sobre el vault.
//
// Notas:
//   - No es idempotente: cada ejecución crea una nueva versión del secret y
//     rota las keys. Para rotación post-bootstrap, usar `pnpm rotate-key`
//     (Slice A4.4).

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { exit } from "node:process";

function parseArgs(argv) {
  let vault;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--vault" && argv[i + 1]) {
      vault = argv[i + 1];
      i += 1;
    }
  }
  if (!vault) {
    process.stderr.write(
      "Usage: node scripts/bootstrap-mcp-api-keys.mjs --vault <kv-name>\n",
    );
    exit(2);
  }
  return { vault };
}

function generateKey(clientId) {
  const plaintext = randomBytes(32).toString("base64url");
  const keyHash = createHash("sha256").update(plaintext).digest("base64url");
  const today = new Date().toISOString().slice(0, 10);
  const keyId = `k-${today}-${clientId}`;
  return {
    plaintext,
    entry: {
      clientId,
      keyId,
      keyHash,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    },
  };
}

function azSet(vault, name, value, tags) {
  const args = [
    "keyvault",
    "secret",
    "set",
    "--vault-name",
    vault,
    "--name",
    name,
    "--value",
    value,
    "--output",
    "none",
  ];
  if (tags) {
    args.push("--tags");
    for (const [k, v] of Object.entries(tags)) {
      args.push(`${k}=${v}`);
    }
  }
  const result = spawnSync("az", args, { stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(
      `az keyvault secret set --name ${name} failed:\n${result.stderr.toString()}`,
    );
  }
}

const { vault } = parseArgs(process.argv.slice(2));

const web = generateKey("web");
const dev = generateKey("dev");
const keysJson = JSON.stringify([web.entry, dev.entry]);

azSet(vault, "mcp-api-keys", keysJson, { purpose: "mcp-bearer-hashes" });
azSet(vault, "mcp-api-key-web", web.plaintext, { purpose: "mcp-bearer" });

process.stdout.write(`# Bootstrap completado en vault: ${vault}\n`);
process.stdout.write(`#   - mcp-api-keys      (JSON con hashes para web + dev)\n`);
process.stdout.write(`#   - mcp-api-key-web   (plaintext de clientId "web")\n`);
process.stdout.write(`# Plaintexts (única vez — guardalos en un secret manager local):\n`);
process.stdout.write(`MCP_BEARER_WEB=${web.plaintext}\n`);
process.stdout.write(`MCP_BEARER_DEV=${dev.plaintext}\n`);
