#!/usr/bin/env node
// Bootstrap del Slice S1.2 de tasks/todo-storage.md.
//
// Lee la key 1 del Storage Account indicado y la persiste como secret
// `storage-account-key` en el Key Vault. Esa key es consumida por la
// definición `Microsoft.App/managedEnvironments/storages` del CAE para
// montar el File Share `mcp-data` como volumen SMB en la Container App MCP.
//
// Uso:
//   node scripts/seed-storage-key-secret.mjs \
//     --storage-account <st-name> \
//     --vault <kv-name>
//
// Requisitos:
//   - `az` CLI instalada y `az login` completado.
//   - El usuario debe tener:
//       * `Storage Account Key Operator Service Role` o `Owner` sobre el storage account
//       * `Key Vault Secrets Officer` (o equivalente) sobre el vault.
//
// Idempotencia:
//   Si el secret ya existe y su valor coincide con la key actual, el script
//   no escribe una nueva versión. Si difiere (rotación), se crea una versión
//   nueva. Salida exit 0 en ambos casos.
//
// Rotación:
//   Para rotar la key del storage, ejecutar `az storage account keys renew`
//   y volver a correr este script. Container Apps necesita un re-deploy del
//   CAE storage definition para tomar la nueva key.

import { spawnSync } from "node:child_process";
import { exit } from "node:process";

function parseArgs(argv) {
  let storageAccount;
  let vault;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--storage-account" && argv[i + 1]) {
      storageAccount = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--vault" && argv[i + 1]) {
      vault = argv[i + 1];
      i += 1;
    }
  }
  if (!storageAccount || !vault) {
    process.stderr.write(
      "Usage: node scripts/seed-storage-key-secret.mjs --storage-account <st-name> --vault <kv-name>\n",
    );
    exit(2);
  }
  return { storageAccount, vault };
}

function az(args) {
  const result = spawnSync("az", args, { stdio: ["ignore", "pipe", "pipe"] });
  return {
    status: result.status,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

function fetchStorageKey(storageAccount) {
  const r = az([
    "storage",
    "account",
    "keys",
    "list",
    "--account-name",
    storageAccount,
    "--query",
    "[0].value",
    "--output",
    "tsv",
  ]);
  if (r.status !== 0) {
    throw new Error(`az storage account keys list failed:\n${r.stderr}`);
  }
  const key = r.stdout.trim();
  if (!key) {
    throw new Error(`Storage account ${storageAccount} returned an empty key`);
  }
  return key;
}

function fetchExistingSecret(vault, name) {
  const r = az([
    "keyvault",
    "secret",
    "show",
    "--vault-name",
    vault,
    "--name",
    name,
    "--query",
    "value",
    "--output",
    "tsv",
  ]);
  if (r.status === 0) {
    return r.stdout.trim();
  }
  // Not found is expected on first run; surface other errors.
  if (/SecretNotFound|not found/i.test(r.stderr)) {
    return null;
  }
  throw new Error(`az keyvault secret show failed:\n${r.stderr}`);
}

function setSecret(vault, name, value) {
  const r = az([
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
  ]);
  if (r.status !== 0) {
    throw new Error(`az keyvault secret set failed:\n${r.stderr}`);
  }
}

const { storageAccount, vault } = parseArgs(process.argv.slice(2));
const SECRET_NAME = "storage-account-key";

const liveKey = fetchStorageKey(storageAccount);
const existing = fetchExistingSecret(vault, SECRET_NAME);

if (existing === liveKey) {
  process.stdout.write(
    `# Secret '${SECRET_NAME}' in vault '${vault}' already matches storage key — no change.\n`,
  );
  exit(0);
}

setSecret(vault, SECRET_NAME, liveKey);
process.stdout.write(
  `# Secret '${SECRET_NAME}' updated in vault '${vault}' from storage account '${storageAccount}'.\n`,
);
