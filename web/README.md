# Cruce Chile · web

Cliente web del MCP server [Cruce Chile](../mcp-server/). App Next.js 16 (App Router) que recibe URLs/RUTs/nombres y muestra el `full_evaluation` consolidado: score determinístico, razones por etapa y fuentes oficiales consultadas.

La consulta al MCP corre en **server actions**; el navegador nunca ve la API key.

## Stack

- Node.js ≥ 22
- Next.js `16.2.4` (App Router, `output: "standalone"`)
- React `19.2.4`
- Tailwind CSS v4
- TypeScript estricto
- `zod` para validar respuestas del MCP
- pnpm `10.x`

## Variables de entorno

| Var | Default (prod) | Descripción |
|---|---|---|
| `MCP_URL` | `http://ca-mcp-fintech-dev` (DNS interno del CAE) | URL del MCP. En local, apuntar al MCP corriendo (ej. `http://localhost:3001`). |
| `MCP_API_KEY` | inyectada vía `secretRef` desde KV | Bearer key registrada en el MCP. Sin ella el server action retorna estado degradado. |
| `PORT` | `3000` | Puerto del server Next.js (standalone). |
| `HOSTNAME` | `0.0.0.0` | Bind address. |
| `NEXT_TELEMETRY_DISABLED` | `1` | Desactiva la telemetría de Next. |

## Desarrollo local

```bash
pnpm install
pnpm typecheck
MCP_URL=http://localhost:3001 MCP_API_KEY=<dev-bearer> pnpm dev
```

Abrir [http://localhost:3000](http://localhost:3000). Si el MCP no está corriendo, la UI muestra el error degradado (no propaga 5xx).

Para generar una `MCP_API_KEY` de dev, ver `pnpm dev:gen-key` en el repo del MCP.

## Build de producción

```bash
pnpm build
node .next/standalone/server.js   # requiere copiar .next/static y public/ al standalone
```

## Docker

```bash
docker build --platform linux/amd64 -t web-v2:local .
docker run --rm -p 3000:3000 \
  -e MCP_URL=http://host.docker.internal:3001 \
  -e MCP_API_KEY=<dev-bearer> \
  web-v2:local
```

Imagen multi-stage (`node:22-alpine`), output standalone, usuario no-root, ~76 MB.

## Deploy

Container App `ca-web-v2-fintech-dev` en `cae-fintech-dev` (RG `oarocha-fintech`, suscripción Pharmkt Sponsorship). Coexiste con `ca-web-fintech-dev` (placeholder previo).

- **FQDN público:** `https://ca-web-v2-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io/`
- **Health:** `/api/health` → `{ status, name, version }`
- **Identity:** `uai-web-dev` (UAI) con `AcrPull` + `Key Vault Secrets User` con scope al secret `mcp-api-key-web`.
- **Secret KV-referenced:** `mcp-api-key` → `kv-fintech-dev-ic66pjdlb/secrets/mcp-api-key-web`, inyectado como env `MCP_API_KEY` con `secretRef`.

CI/CD vía GitHub Actions con OIDC (App Reg `gh-fintech-mcp-deployer`). Push a `main` o `workflow_dispatch` dispara `.github/workflows/deploy.yml`: build → push a `acr.../web-v2:<sha>` → `az containerapp update` → smoke test `/api/health`.

## Estructura

```
app/
├── _components/         # Client/Server components puros (EvaluateForm, ResultView)
├── actions/             # Server Actions ('use server')
│   └── evaluate.ts
├── api/health/          # Liveness probe
├── layout.tsx
└── page.tsx             # Server Component, dynamic="force-dynamic"
lib/
├── logger.ts            # JSON Lines a stdout/stderr + hashInput
└── mcp-client.ts        # Streamable HTTP client + Zod schemas
Dockerfile               # multi-stage, output standalone
.github/workflows/
└── deploy.yml           # OIDC + buildx + containerapp update
```

## Comandos operacionales

```bash
# Logs del Container App
az containerapp logs show -g oarocha-fintech -n ca-web-v2-fintech-dev --tail 50

# Revisión activa
az containerapp revision list -g oarocha-fintech -n ca-web-v2-fintech-dev \
  --query "[?properties.active].{name:name, image:properties.template.containers[0].image, healthState:properties.healthState}" -o table

# Forzar nueva revisión con la imagen actual
az containerapp update -g oarocha-fintech -n ca-web-v2-fintech-dev \
  --revision-suffix "manual-$(date +%s)"
```
