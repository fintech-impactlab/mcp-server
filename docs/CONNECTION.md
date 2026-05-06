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

**Acceso público desde 2026-05-06:** el MCP está `external: true` en `infra/main.bicep:120` con `minReplicas: 1` (sin cold starts). Cualquier cliente MCP HTTP con el bearer correcto puede conectarse. Ver Camino C abajo.

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

## 6. Camino C — Cliente MCP real (Claude Code, Claude Desktop, IDE) ✅

Desde 2026-05-06 el MCP se expone públicamente con auth bearer (`external: true` en `infra/main.bicep:120`, `minReplicas: 1` para evitar cold starts). FQDN público:

```
https://ca-mcp-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io
```

### Registrar en Claude Code

```bash
RG=oarocha-fintech
KV=$(az deployment group show -g $RG -n storage-volume-s1 --query 'properties.outputs.keyVaultName.value' -o tsv)
BEARER=$(az keyvault secret show --vault-name "$KV" --name mcp-api-key-web --query value -o tsv)

claude mcp add --transport http fintech-mcp \
  https://ca-mcp-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io/mcp \
  --header "Authorization: Bearer $BEARER"
```

Verificá con `/mcp` dentro de Claude Code o `claude mcp list`. Las dos tools (`get_market_reference_rates`, `explain_law_simple`, más las que la otra sesión vaya registrando) aparecen listadas.

### Otros clientes MCP

Cualquier cliente que soporte el transport HTTP (Streamable) sirve. Datos de conexión:

| Campo | Valor |
|-------|-------|
| URL | `https://ca-mcp-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io/mcp` |
| Method | POST |
| Auth | `Authorization: Bearer <plaintext de KV/mcp-api-key-web>` |
| Headers obligatorios | `Content-Type: application/json`, `Accept: application/json, text/event-stream` |
| Protocol version | `2024-11-05` (negociada en `initialize`) |

### Validación rápida con curl

```bash
URL="https://ca-mcp-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io"
KV=$(az deployment group show -g oarocha-fintech -n storage-volume-s1 --query 'properties.outputs.keyVaultName.value' -o tsv)
BEARER=$(az keyvault secret show --vault-name "$KV" --name mcp-api-key-web --query value -o tsv)

# Health check (sin auth)
curl -sS "$URL/health"

# initialize handshake (mandatorio antes de tools/list)
curl -sS -X POST "$URL/mcp" \
  -H "Authorization: Bearer $BEARER" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

> **Importante sobre stateless:** el MCP corre con `sessionIdGenerator: undefined` (`mcp-server/src/index.ts:62`), o sea cada POST es una nueva sesión. Eso significa que `tools/list` o `tools/call` directos sin `initialize` previo en la misma request devuelven `-32601 Method not found`. Los clientes MCP estándar (Claude Code, etc.) hacen initialize automáticamente, así que no es problema en uso real — solo en tests manuales con curl.

### Seguridad

- Auth bearer obligatoria en `/mcp` POST. Token aleatorio de 32 bytes URL-safe, vive en Key Vault (`mcp-api-key-web`).
- Logs de auth failure se hashean (no se loguea el bearer plaintext, ver `auth.failure` en logs).
- Para rotar el bearer: re-correr `node mcp-server/scripts/bootstrap-mcp-api-keys.mjs --vault $KV` y redeployar el web app para que tome el nuevo plaintext (también hay que actualizar el header en Claude Code con `claude mcp remove fintech-mcp` + `claude mcp add` con el nuevo bearer).
- `external: true` queda en `infra/main.bicep:120`. Si querés revertir a internal, cambiar a `false` y redeployar (rompe los clientes externos).

### Alternativas no implementadas

- **(C2)** Proxy en el web (`web/src/app/api/mcp/route.ts`) que reenvíe POST al MCP interno. Más complejo pero permite mantener `external: false` en el MCP. Útil si querés exponer solo subset de tools o agregar rate limiting al frente.
- **(C3)** Private Endpoint + VNET integration. Costo extra (~$7/mes), justificable solo en prod si el bearer no alcanza como gate.

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
