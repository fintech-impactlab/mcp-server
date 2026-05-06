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
pnpm start           # node dist/index.js
pnpm dev             # tsc --watch (no hot-reload del server)

curl http://localhost:3001/health
# → {"status":"ok","name":"fintech-mcp","version":"0.1.0"}
```

Variables de entorno:

| Var    | Default | Descripción                                |
|--------|---------|--------------------------------------------|
| `PORT` | `3001`  | Puerto donde Express escucha en `0.0.0.0`. |

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
