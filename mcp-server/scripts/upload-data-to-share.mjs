#!/usr/bin/env node
// Bootstrap del Slice S2.1 de tasks/todo-storage.md.
//
// Sincroniza el contenido de la carpeta local `data/` al File Share Azure
// `mcp-data` (montado como /app/data en la Container App MCP). Layout destino:
//
//   snapshots/cmf/         ← *.csv y *.xlsx de data/
//   snapshots/rpsf/        ← directorio vacío, jobs lo poblan luego
//   normativas/            ← recursivo desde data/normativas/ (incluye sii/)
//   audit/                 ← directorio vacío, runtime lo puebla
//
// Idempotencia: az storage file upload-batch sobreescribe; az storage directory
// create no falla si ya existe. Re-correr no genera churn.
//
// Uso:
//   node scripts/upload-data-to-share.mjs \
//     --storage-account <st> \
//     --vault <kv> \
//     [--data-dir ./data] \
//     [--share mcp-data]
//
// Requisitos:
//   - `az login` completado, con permiso lectura en KV (Key Vault Secrets User)
//     y escritura en el File Share (la account key viene del KV).
//   - El secret `storage-account-key` debe existir en el KV. Sembrarlo primero
//     con scripts/seed-storage-key-secret.mjs (S1.2).

import { spawnSync } from "node:child_process";
import path from "node:path";
import { exit } from "node:process";

function parseArgs(argv) {
  let storageAccount;
  let vault;
  let dataDir = path.resolve(process.cwd(), "data");
  let share = "mcp-data";
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--storage-account" && v) {
      storageAccount = v;
      i += 1;
    } else if (a === "--vault" && v) {
      vault = v;
      i += 1;
    } else if (a === "--data-dir" && v) {
      dataDir = path.resolve(v);
      i += 1;
    } else if (a === "--share" && v) {
      share = v;
      i += 1;
    }
  }
  if (!storageAccount || !vault) {
    process.stderr.write(
      "Usage: node scripts/upload-data-to-share.mjs --storage-account <st> --vault <kv> [--data-dir ./data] [--share mcp-data]\n",
    );
    exit(2);
  }
  return { storageAccount, vault, dataDir, share };
}

function az(args, opts = {}) {
  const result = spawnSync("az", args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  return {
    status: result.status,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

function fetchAccountKey(vault, secretName) {
  const r = az([
    "keyvault",
    "secret",
    "show",
    "--vault-name",
    vault,
    "--name",
    secretName,
    "--query",
    "value",
    "--output",
    "tsv",
  ]);
  if (r.status !== 0) {
    throw new Error(
      `az keyvault secret show '${secretName}' failed:\n${r.stderr}`,
    );
  }
  const key = r.stdout.trim();
  if (!key) {
    throw new Error(`Secret '${secretName}' returned empty value`);
  }
  return key;
}

function uploadBatch({ account, key, share, source, destination, pattern }) {
  const args = [
    "storage",
    "file",
    "upload-batch",
    "--account-name",
    account,
    "--account-key",
    key,
    "--destination",
    share,
    "--destination-path",
    destination,
    "--source",
    source,
    "--no-progress",
    "--output",
    "none",
  ];
  if (pattern) {
    args.push("--pattern", pattern);
  }
  const r = az(args);
  if (r.status !== 0) {
    throw new Error(
      `az storage file upload-batch (${source} → ${destination}${pattern ? ` ${pattern}` : ""}) failed:\n${r.stderr}`,
    );
  }
  process.stdout.write(
    `# uploaded: ${source}${pattern ? ` (${pattern})` : ""} → ${share}/${destination}\n`,
  );
}

function ensureDirectory({ account, key, share, dir }) {
  const r = az([
    "storage",
    "directory",
    "create",
    "--account-name",
    account,
    "--account-key",
    key,
    "--share-name",
    share,
    "--name",
    dir,
    "--output",
    "none",
  ]);
  // 'already exists' es OK (idempotencia).
  if (r.status !== 0 && !/already exists|ResourceAlreadyExists/i.test(r.stderr)) {
    throw new Error(`az storage directory create '${dir}' failed:\n${r.stderr}`);
  }
  process.stdout.write(`# directory: ${share}/${dir}\n`);
}

const { storageAccount, vault, dataDir, share } = parseArgs(process.argv.slice(2));

const key = fetchAccountKey(vault, "storage-account-key");

// Snapshots CMF: CSVs + XLSXs viven sueltos en data/, los queremos en snapshots/cmf/.
uploadBatch({
  account: storageAccount,
  key,
  share,
  source: dataDir,
  destination: "snapshots/cmf",
  pattern: "*.csv",
});
uploadBatch({
  account: storageAccount,
  key,
  share,
  source: dataDir,
  destination: "snapshots/cmf",
  pattern: "*.xlsx",
});

// Normativas: estructura recursiva (mantiene subcarpeta sii/).
uploadBatch({
  account: storageAccount,
  key,
  share,
  source: path.join(dataDir, "normativas"),
  destination: "normativas",
});

// Directorios vacíos para que el layout esté completo desde día 0.
// Jobs/runtime los poblarán cuando corresponda.
ensureDirectory({ account: storageAccount, key, share, dir: "snapshots/rpsf" });
ensureDirectory({ account: storageAccount, key, share, dir: "audit" });

process.stdout.write(`# done — File Share '${share}' synced from ${dataDir}\n`);
