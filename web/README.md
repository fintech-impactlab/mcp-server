# web

Fachada pública del MCP. Aplicación Next.js 15 con App Router que actúa como **cliente del `mcp-server`** y como única superficie expuesta a internet — el MCP queda detrás del DNS interno del Container Apps Environment.

Por ahora es un placeholder: una sola página que llama al `/health` del MCP y muestra el resultado, validando end-to-end que el stack está vivo. La UI real (casos de uso del análisis) se construye encima de este esqueleto en una iteración posterior.

## Stack

- Node.js ≥ 22
- Next.js `15.0.3` (App Router, `output: 'standalone'`)
- React `18.3.1`
- TypeScript estricto + `noUncheckedIndexedAccess`
- pnpm `10.33.0`

## Desarrollo local

```bash
pnpm install
pnpm typecheck
pnpm dev             # Next dev server en http://localhost:3000
pnpm build && pnpm start   # build de producción
```

Variables de entorno:

| Var                       | Default                          | Descripción                                                            |
|---------------------------|----------------------------------|------------------------------------------------------------------------|
| `MCP_URL`                 | DNS interno del CAE (vía Bicep)  | URL del MCP server. En local, apuntar a un MCP corriendo (ej. `http://localhost:3001`). |
| `PORT`                    | `3000`                      | Puerto del server Next.js.                                              |
| `HOSTNAME`                | `0.0.0.0`                   | Bind address (relevante en runtime standalone).                         |
| `NEXT_TELEMETRY_DISABLED` | `1`                         | Desactiva la telemetría de Next.                                        |

## Comportamiento

- `app/page.tsx` es un **Server Component** con `export const dynamic = 'force-dynamic'`.
- En cada request hace `fetch(${MCP_URL}/health, { cache: 'no-store', signal: AbortSignal.timeout(2000) })` y renderiza el JSON resultante o el error.
- Si la llamada al MCP falla (timeout, 5xx, DNS), la página igual responde 200 mostrando el mensaje de error — no propaga el fallo al cliente.

## Docker

Multi-stage `node:22-alpine`, usa el output `standalone` de Next.js (copia `.next/standalone` y `.next/static`), usuario no-root, imagen final ~70 MB.

```bash
docker build --platform linux/amd64 -t web:bootstrap .
docker run --rm -p 3000:3000 -e MCP_URL="http://host.docker.internal:3001" web:bootstrap
```

> Notar: en el builder stage `NODE_ENV` se setea a `production` **después** del `pnpm install`. Si se setea antes, pnpm no instala devDependencies y `next build` falla.

## Deploy

Container App con **ingress externo HTTPS** en el CAE del proyecto. Es el único componente del stack expuesto a internet (los nombres concretos viven en `infra/parameters/<env>.bicepparam`).

UAI dedicada con solo `AcrPull` — la web no toca KV ni Storage. La variable `MCP_URL` se inyecta desde Bicep como FQDN corto del MCP, resuelto por DNS interno del CAE.

Bicep: [`../infra/`](../infra). Plan: [`../tasks/plan.md`](../tasks/plan.md). Tareas: [`../tasks/todo.md`](../tasks/todo.md).
