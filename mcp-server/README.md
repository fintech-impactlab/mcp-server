# mcp-server

MCP (Model Context Protocol) server del proyecto Cruce Chile, expuesto sobre Streamable HTTP en modo stateless. Por ahora es un bootstrap **sin tools registradas**: solo `/health` y un endpoint `/mcp` vacío. Las **11 tools granulares + 1 tool de orquestación** (ver [README raíz](../README.md) y [tasks/plan-tools.md](../tasks/plan-tools.md)) se implementan en un plan posterior (Cluster B), sobre la infra entregada por Slices 1–6.

## Stack

- Node.js ≥ 22 (LTS actual)
- TypeScript con `strict: true` + `noUncheckedIndexedAccess`
- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) `1.29.0`
- Express `4.21.2`
- pnpm `10.33.0` (gestionado por corepack)

## Desarrollo local

```bash
pnpm install
pnpm typecheck       # tsc --noEmit
pnpm build           # tsc → dist/
pnpm test            # node --test (requiere build previo)
pnpm dev             # tsc --watch (sin hot-reload del server)
pnpm dev:server      # node --watch dist/index.js (hot-reload del server)

# 1) Generar una key de dev (no se guarda; cópiala al .env.local o expórtala)
pnpm dev:gen-key
# Output:
#   MCP_API_KEYS_LOCAL_JSON='[{"clientId":"dev","keyId":"local","keyHash":"...","createdAt":"...","revokedAt":null}]'
#   MCP_DEV_BEARER=<plaintext>

# 2) Levantar el server con esa key
eval "$(pnpm -s dev:gen-key)"   # exporta ambas vars en la shell actual
pnpm build && pnpm start

# 3) Verificar
curl -s http://localhost:3001/health
# → {"status":"ok","name":"fintech-mcp","version":"0.1.0"}

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/mcp -d '{}'
# → 401 (Authentication required)

curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_DEV_BEARER" \
  http://localhost:3001/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# → 200 + JSON-RPC body (Method not found mientras no haya tools registradas)
```

Variables de entorno:

| Var | Default | Descripción |
|---|---|---|
| `PORT` | `3001` | Puerto donde Express escucha en `0.0.0.0`. |
| `MCP_API_KEYS_LOCAL_JSON` | _(unset)_ | **Solo dev.** JSON array de `KeyEntry` que el `KeyStore` usa en lugar de Key Vault. Generar con `pnpm dev:gen-key`. Si está seteada, gana sobre `KEY_VAULT_URL`. |
| `KEY_VAULT_URL` | _(unset)_ | URL del Key Vault que provee el secret `mcp-api-keys` en producción. Resolución vía `DefaultAzureCredential` (UAI `uai-mcp-<env>` en Container Apps; `az login` en dev). |
| `MCP_API_KEYS_SECRET_NAME` | `mcp-api-keys` | Nombre del secret en KV. |

> ⚠️ El `plaintext` que imprime `dev:gen-key` se entrega **una sola vez**. No se persiste en KV (solo el hash sha256 entra al `MCP_API_KEYS_LOCAL_JSON`). Para detalles del formato y reglas, ver [`CONVENTIONS.md`](CONVENTIONS.md).

## Endpoints

| Método | Ruta      | Comportamiento                                                                 |
|--------|-----------|--------------------------------------------------------------------------------|
| GET    | `/health` | Health check liviano. Retorna `{ status, name, version }`.                     |
| POST   | `/mcp`    | Streamable HTTP transport (stateless). Crea un transport por request.          |
| GET    | `/mcp`    | 405 — modo stateless no soporta GET (sin sesiones).                            |

## Docker

Multi-stage (`builder` → `deps` → `runtime`), base `node:22-alpine`, usuario no-root, imagen final ~60 MB.

```bash
docker build --platform linux/amd64 -t mcp-server:bootstrap .
docker run --rm -p 3001:3001 mcp-server:bootstrap
```

## Deploy

Container App en el CAE del proyecto, **ingress interno** (no expuesto a internet). Solo es alcanzable desde otros containers del mismo environment vía DNS corto del CAE (los nombres concretos viven en `infra/parameters/<env>.bicepparam`).

RBAC asignado a la User-Assigned Identity del MCP:

- `AcrPull` sobre el ACR (para que Container Apps pueda jalar la imagen)
- `Key Vault Secrets User` sobre el KV (lectura de secrets vía managed identity)
- `Storage Blob Data Contributor` sobre el Storage Account (caches `cache-cmf`, `cache-rpsf`, `audit`)

El Bicep está en [`../infra/`](../infra). Ver [`../tasks/plan.md`](../tasks/plan.md) y [`../tasks/todo.md`](../tasks/todo.md) para el contexto completo.
