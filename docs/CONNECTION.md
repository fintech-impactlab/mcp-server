# Conexión y prueba del MCP server

Guía operativa para probar el MCP `ca-mcp-fintech-dev` desplegado en el RG `oarocha-fintech` (sub Pharmkt Sponsorship, region `eastus`).

## 1. Topología actual

```
                   Internet
                       │
                       ▼
        ┌────────────────────────────┐
        │ ca-web-fintech-dev         │  external: true, ingress HTTPS
        │ (Next.js placeholder)      │  FQDN: ca-web-fintech-dev.<cae>.eastus.azurecontainerapps.io
        └──────────────┬─────────────┘
                       │ http://ca-mcp-fintech-dev (DNS interno del CAE)
                       │ Authorization: Bearer <plaintext mcp-api-key-web>
                       ▼
        ┌────────────────────────────┐
        │ ca-mcp-fintech-dev         │  external: false, port 3001
        │ (Node MCP server)          │  Solo accesible desde dentro del CAE
        │  ├─ GET  /health           │  sin auth
        │  ├─ POST /mcp              │  Bearer required, JSON-RPC over Streamable HTTP
        │  └─ GET  /mcp              │  405
        │                            │  Volumen: /app/data ← File Share `mcp-data`
        └────────────────────────────┘
```

**Tools registradas hoy** (ver `mcp-server/src/index.ts`):

- `get_market_reference_rates` — tasas BCE (TPM, UF, USD/CLP, EUR/CLP) con cache 24h.
- `explain_law_simple` — explicación de leyes chilenas vía API BCN Ley Fácil.

> Próximas tools (Slices 4-13 de `tasks/todo-tools.md`): `check_blacklist`, `check_whitelist`, `analyze_domain`, `check_dns_ownership`, `verify_chilean_entity`, `check_regulator_status`, `analyze_business_model`, `get_applicable_regulation`, `get_official_complaint_channels`, `full_evaluation`.

## 2. Endpoints

| Endpoint | Acceso | Auth | Para qué sirve |
|----------|--------|------|----------------|
| `https://<web-fqdn>/` | público | ninguno | Smoke test extremo-a-extremo (web hace SSR fetch al `/health` del MCP). Útil para validar que la red interna del CAE funciona y el MCP está vivo. |
| `http://ca-mcp-fintech-dev/health` | solo dentro del CAE | ninguno | Health check directo del MCP. |
| `http://ca-mcp-fintech-dev/mcp` (POST) | solo dentro del CAE | `Bearer <plaintext>` | Protocolo MCP (JSON-RPC over Streamable HTTP). Lo consumen clientes MCP. |

**Limitación clave:** el MCP es **internal** al CAE (`external: false` en `infra/main.bicep:121`). No se puede curl-ear desde Internet ni configurar Claude Desktop directamente sin: (a) cambiar a `external: true`, (b) montar un proxy en el web app, o (c) VNET integration + Private Endpoint.

## 3. Recuperar el Bearer token

El plaintext del clientId `web` vive en Key Vault como `mcp-api-key-web` (poblado por `mcp-server/scripts/bootstrap-mcp-api-keys.mjs`).

```bash
RG=oarocha-fintech
KV=$(az deployment group show -g $RG -n storage-volume-s1 --query 'properties.outputs.keyVaultName.value' -o tsv)

BEARER=$(az keyvault secret show --vault-name "$KV" --name mcp-api-key-web --query 'value' -o tsv)
echo "Bearer (43 chars): ${BEARER:0:8}…${BEARER: -4}"
```

Existe también un clientId `dev` en el JSON `mcp-api-keys` (hashes), pero su plaintext **no se persiste** — solo se imprime una vez al correr `bootstrap-mcp-api-keys.mjs`. Si lo necesitás, regenerá las keys con ese script (rota ambas a la vez).

## 4. Camino A — Smoke test público (sin auth, sin TTY)

El más simple. Solo prueba que el web puede alcanzar al MCP.

```bash
RG=oarocha-fintech
WEB=$(az containerapp show -n ca-web-fintech-dev -g $RG \
  --query 'properties.configuration.ingress.fqdn' -o tsv)

curl -sS -o /tmp/web.html -w "HTTP %{http_code} en %{time_total}s\n" "https://$WEB/"
grep -oE "status[^,]*ok|fintech-mcp|0\\.1\\.0|no se pudo[^<]*" /tmp/web.html | head -5
```

**Salida esperada (cuando MCP está caliente):**

```
HTTP 200 en 0.40s
status</dt><dd ...>ok
fintech-mcp
0.1.0
```

**Si ves `no se pudo alcanzar al MCP server: ... timeout`:** el MCP está scaled-to-zero (`minReplicas: 0`) y el SSR fetch del web tiene timeout 2s. Reintentá tras 30s — el primer pageload despierta una réplica y los siguientes responden en <500ms.

## 5. Camino B — Protocolo MCP via `containerapp exec` (con auth, requiere TTY real)

Para validar JSON-RPC `tools/list` y `tools/call` hay que entrar al container del web (que tiene `MCP_API_KEY` en env y resolución DNS interna). Requiere terminal con TTY (no funciona vía harness automatizado).

```bash
RG=oarocha-fintech
MCP=ca-mcp-fintech-dev
WEB=ca-web-fintech-dev

# 1) Listar las tools registradas
az containerapp exec -n "$WEB" -g $RG --command \
  "sh -c 'wget -qO- --header=\"Authorization: Bearer \$MCP_API_KEY\" --header=\"Content-Type: application/json\" --header=\"Accept: application/json, text/event-stream\" --post-data=\"{\\\"jsonrpc\\\":\\\"2.0\\\",\\\"id\\\":1,\\\"method\\\":\\\"tools/list\\\"}\" http://$MCP/mcp'"

# 2) Invocar get_market_reference_rates
az containerapp exec -n "$WEB" -g $RG --command \
  "sh -c 'wget -qO- --header=\"Authorization: Bearer \$MCP_API_KEY\" --header=\"Content-Type: application/json\" --header=\"Accept: application/json, text/event-stream\" --post-data=\"{\\\"jsonrpc\\\":\\\"2.0\\\",\\\"id\\\":2,\\\"method\\\":\\\"tools/call\\\",\\\"params\\\":{\\\"name\\\":\\\"get_market_reference_rates\\\",\\\"arguments\\\":{}}}\" http://$MCP/mcp'"

# 3) Invocar explain_law_simple (ejemplo: Ley 21.521 Fintech)
az containerapp exec -n "$WEB" -g $RG --command \
  "sh -c 'wget -qO- --header=\"Authorization: Bearer \$MCP_API_KEY\" --header=\"Content-Type: application/json\" --header=\"Accept: application/json, text/event-stream\" --post-data=\"{\\\"jsonrpc\\\":\\\"2.0\\\",\\\"id\\\":3,\\\"method\\\":\\\"tools/call\\\",\\\"params\\\":{\\\"name\\\":\\\"explain_law_simple\\\",\\\"arguments\\\":{\\\"lawNumber\\\":\\\"21521\\\"}}}\" http://$MCP/mcp'"
```

**Salida esperada de `tools/list`:**

```json
{"jsonrpc":"2.0","id":1,"result":{"tools":[
  {"name":"get_market_reference_rates","description":"…","inputSchema":{…}},
  {"name":"explain_law_simple","description":"…","inputSchema":{…}}
]}}
```

> **Nota sobre la imagen:** la imagen del web app (Next.js sobre node-alpine) **no incluye `curl`** por default; `wget` sí está. Por eso los ejemplos usan `wget --post-data`. El header `Accept: application/json, text/event-stream` es requerido por el `StreamableHTTPServerTransport` del MCP SDK.

## 6. Camino C — Cliente MCP real (Claude Desktop, IDE) — **NO disponible hoy**

Para conectar un cliente MCP estándar (Claude Desktop, VS Code MCP extension, etc.) hace falta uno de estos cambios de infra:

- **(C1)** Hacer `external: true` en `infra/main.bicep:121` y rotar el bearer asumiendo exposición pública. Cambio de 1 línea + redeploy. Costo: el endpoint queda expuesto a Internet con auth de bearer; aceptable si rotás claves periódicamente y monitoreás logs de auth.failure.
- **(C2)** Agregar un route handler `web/src/app/api/mcp/route.ts` que sea un proxy del web al MCP interno. Costo: hay que reimplementar el streaming POST → MCP (Next.js no streamea body grande por default; revisar `runtime: 'nodejs'` + `dynamic: 'force-dynamic'`).
- **(C3)** Private Endpoint + VNET integration al CAE. Costo: cambio mayor de infra, costo extra del PE (~$7/mes). Justificable solo en prod.

Ninguno está implementado todavía. Está fuera del alcance del slice plan-storage; quedaría como tema para `tasks/todo.md` Slice 7+ o un nuevo plan.

## 7. Estado actual del deploy (2026-05-06)

| Recurso | Valor |
|---------|-------|
| RG | `oarocha-fintech` |
| Subscription | Pharmkt Sponsorship |
| Storage account | `stfintechdevic66pjdlbzw6` |
| File Share | `mcp-data` (100 GiB cuota, ~300 MB usados, 28 archivos) |
| Key Vault | `kv-fintech-dev-ic66pjdlb` |
| MCP container | `ca-mcp-fintech-dev`, revision `0000017`, 1 réplica running |
| Web container | `ca-web-fintech-dev`, FQDN `ca-web-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io` |
| UAI MCP | `uai-mcp-dev` con roles: AcrPull, Key Vault Secrets User |
| Bearer plaintext | `kv-fintech-dev-ic66pjdlb`/`mcp-api-key-web` |

## 8. Troubleshooting rápido

| Síntoma | Causa probable | Mitigación |
|---------|---------------|------------|
| Web responde 200 pero dice "no se pudo alcanzar al MCP server: timeout" | MCP scaled a 0 (minReplicas=0); cold start > 2s | Reintentá tras 30s. Para evitar: `az containerapp update -n ca-mcp-fintech-dev -g $RG --min-replicas 1` (cuesta más, pero responde inmediato). |
| `wget` desde el web container devuelve `401 Authentication required` | `MCP_API_KEY` env vacía o el bearer revocado | Verificar el secret `mcp-api-key-web` en KV; redeployar el web app. |
| `wget` devuelve `403 Invalid or revoked key` | El plaintext y los hashes en `mcp-api-keys` se desincronizaron | Re-correr `node mcp-server/scripts/bootstrap-mcp-api-keys.mjs --vault $KV` (rota ambos secrets). Re-deployar mcp + web para que tomen los nuevos. |
| `containerapp exec` falla con `tty.setcbreak` | Estás en una shell sin TTY (CI, harness, etc.) | Usar terminal real (Terminal.app, iTerm). |
| `/health` desde web retorna 200 pero `tools/list` devuelve `tools: []` | Boot del MCP falló en registrar las tools (revisar logs `server.tool_registered`) | `az containerapp logs show -n ca-mcp-fintech-dev -g $RG --tail 100` y buscar errores. |

## 9. Logs

`az containerapp logs show -n ca-mcp-fintech-dev -g $RG --tail 50 --follow`

Eventos relevantes:

- `server.data_dir` (boot) — confirma `DATA_DIR` resuelto a `/app/data`.
- `server.auth_keys_loaded` — auth bootstrap OK.
- `server.tool_registered` — una entrada por tool registrada.
- `server.listening` — listo en puerto 3001.
- `auth.failure` — bearer inválido / faltante (sin PII; el header se hashea).
- `tool.call` — invocación exitosa (con `clientId`, `toolName`, `success`).
- `mcp.request_failed` — error en handler MCP.
