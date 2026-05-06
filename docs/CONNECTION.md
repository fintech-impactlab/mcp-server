# Conexión y prueba del MCP server

Guía operativa para probar y consumir el MCP desplegado en Azure Container Apps. Los nombres reales de RG, FQDN, storage account y Key Vault se resuelven en runtime desde los outputs del deployment — esta doc usa placeholders.

## 1. Topología

```
                   Internet
                       │
                       ▼
        ┌────────────────────────────┐
        │ ca-web-<project>-<env>     │  external: true (ingress HTTPS público)
        │ (Next.js placeholder)      │  Smoke UI; SSR fetch al MCP /health.
        └────────────────────────────┘

                   Internet
                       │
                       ▼
        ┌────────────────────────────┐
        │ ca-mcp-<project>-<env>     │  external: true, port 3001
        │ (Node MCP server)          │  Auth: Bearer obligatorio en /mcp
        │  ├─ GET  /health           │  sin auth
        │  ├─ POST /mcp              │  Bearer + JSON-RPC over Streamable HTTP
        │  └─ GET  /mcp              │  405
        │                            │  Volumen: /app/data ← File Share `mcp-data`
        └────────────────────────────┘
```

Naming convention de los recursos (declarado en `infra/main.bicep`):

| Recurso | Patrón |
|---------|--------|
| Resource group | provisto por el operador |
| Storage account | `st<project><env><uniqueSuffix>` (24 chars max, lowercase) |
| File Share | `mcp-data` (fijo) |
| Key Vault | `kv-<project>-<env>-<uniqueSuffix>` |
| MCP container app | `ca-mcp-<project>-<env>` |
| Web container app | `ca-web-<project>-<env>` |
| UAI MCP | `uai-mcp-<env>` |

`<uniqueSuffix>` se deriva de `uniqueString(resourceGroup().id)` en Bicep — estable para un mismo RG.

**Tools registradas hoy** (ver `mcp-server/src/index.ts`):

- `get_market_reference_rates` — tasas BCE (TPM, UF, USD/CLP, EUR/CLP) con cache 24h.
- `explain_law_simple` — explicación de leyes chilenas vía API BCN Ley Fácil.

> Próximas tools (Slices 4-13 de `tasks/todo-tools.md`): `check_blacklist`, `check_whitelist`, `analyze_domain`, `check_dns_ownership`, `verify_chilean_entity`, `check_regulator_status`, `analyze_business_model`, `get_applicable_regulation`, `get_official_complaint_channels`, `full_evaluation`.

## 2. Resolver los nombres del deployment

Todos los comandos asumen variables `RG` y `DEPLOY` (nombre del deployment Bicep) ya seteadas en tu shell. Después de un deploy con `az deployment group create -g <rg> -n <deploy> -f infra/main.bicep --parameters project=<p> env=<e>`:

```bash
RG=<your-resource-group>
DEPLOY=<your-deployment-name>

KV=$(az deployment group show -g $RG -n $DEPLOY \
  --query 'properties.outputs.keyVaultName.value' -o tsv)
ST=$(az deployment group show -g $RG -n $DEPLOY \
  --query 'properties.outputs.storageAccountName.value' -o tsv)
MCP_NAME=$(az deployment group show -g $RG -n $DEPLOY \
  --query 'properties.outputs.mcpAppName.value' -o tsv)
MCP_FQDN=$(az deployment group show -g $RG -n $DEPLOY \
  --query 'properties.outputs.mcpAppFqdn.value' -o tsv)
```

A partir de acá los comandos usan esas variables, no nombres reales.

## 3. Endpoints

| Endpoint | Acceso | Auth | Para qué sirve |
|----------|--------|------|----------------|
| `https://$MCP_FQDN/health` | público | ninguno | Health check del MCP. |
| `https://$MCP_FQDN/mcp` POST | público | `Bearer <plaintext>` | Protocolo MCP (JSON-RPC over Streamable HTTP). Lo consumen clientes MCP. |
| `https://<web-fqdn>/` | público | ninguno | UI placeholder; SSR fetch al `/health` del MCP. Smoke visual. |

> Si en el futuro decidís retornar a ingress interno: cambiar `external: true → false` en `infra/main.bicep` (sección `mcpApp`) y redeployar. Eso rompe los clientes externos pero acota la superficie.

## 4. Recuperar el Bearer token

El plaintext del clientId `web` vive en Key Vault como `mcp-api-key-web` (poblado por `mcp-server/scripts/bootstrap-mcp-api-keys.mjs`).

```bash
BEARER=$(az keyvault secret show --vault-name "$KV" --name mcp-api-key-web --query value -o tsv)
echo "Bearer recuperado (longitud: ${#BEARER})"
```

Existe también un clientId `dev` en el JSON `mcp-api-keys` (hashes), pero su plaintext no se persiste — solo se imprime una vez al correr `bootstrap-mcp-api-keys.mjs`. Si lo necesitás, regenerá las keys con ese script (rota ambas a la vez y obliga a re-deployar el web app y a reactualizar headers en clientes).

## 5. Registrar en Claude Code

Una sola línea:

```bash
claude mcp add --transport http fintech-mcp \
  "https://$MCP_FQDN/mcp" \
  --header "Authorization: Bearer $BEARER"
```

Verificación:

- `claude mcp list` muestra `fintech-mcp`.
- En Claude Code, `/mcp` lista las tools registradas.

Para remover y re-agregar (rotación de bearer u otro motivo):

```bash
claude mcp remove fintech-mcp
# regenerar BEARER si rotaste
claude mcp add --transport http fintech-mcp "https://$MCP_FQDN/mcp" \
  --header "Authorization: Bearer $BEARER"
```

## 6. Otros clientes MCP

Cualquier cliente que soporte transport HTTP (Streamable) sirve. Datos de conexión:

| Campo | Valor |
|-------|-------|
| URL | `https://$MCP_FQDN/mcp` |
| Method | POST |
| Auth | `Authorization: Bearer <plaintext de KV/mcp-api-key-web>` |
| Headers obligatorios | `Content-Type: application/json`, `Accept: application/json, text/event-stream` |
| Protocol version | `2024-11-05` (negociada en `initialize`) |

## 7. Validación rápida con curl

```bash
# Health (sin auth)
curl -sS "https://$MCP_FQDN/health"

# initialize handshake (mandatorio antes de tools/list en stateless)
curl -sS -X POST "https://$MCP_FQDN/mcp" \
  -H "Authorization: Bearer $BEARER" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

> **Stateless mode:** el MCP corre con `sessionIdGenerator: undefined` (`mcp-server/src/index.ts`), así que cada POST es una nueva sesión. Llamar a `tools/list` o `tools/call` directo sin `initialize` previo en la misma request devuelve `-32601 Method not found`. Los clientes MCP estándar (Claude Code, etc.) hacen el handshake automáticamente — esto solo afecta tests manuales con curl.

## 8. Seguridad y rotación

- Auth bearer obligatoria en `/mcp` POST. Token aleatorio de 32 bytes URL-safe (entropía ≈ 256 bits), persistido solo en Key Vault.
- Logs de auth failure se hashean (no se loguea el bearer plaintext, ver `auth.failure` en logs).
- **Rotar el bearer:** re-correr `node mcp-server/scripts/bootstrap-mcp-api-keys.mjs --vault $KV` y redeployar el web app para que tome el nuevo plaintext (el MCP toma el hash actualizado en su próximo `KeyStore.warm()`, default cada 60s). También actualizar el header en clientes externos (`claude mcp remove` + `add`).
- `external: true` queda en `infra/main.bicep`. Bearer es la única defensa al borde — auditá `auth.failure` en logs si ves tráfico raro y rotá si hace falta.

## 9. Logs

```bash
az containerapp logs show -n "$MCP_NAME" -g $RG --tail 50 --follow
```

Eventos relevantes:

- `server.data_dir` (boot) — confirma `DATA_DIR` resuelto a `/app/data`.
- `server.auth_keys_loaded` — auth bootstrap OK.
- `server.tool_registered` — una entrada por tool registrada.
- `server.listening` — listo en puerto 3001.
- `auth.failure` — bearer inválido / faltante (sin PII; el header se hashea).
- `tool.call` — invocación exitosa (con `clientId`, `toolName`, `success`).
- `mcp.request_failed` — error en handler MCP.

## 10. Troubleshooting rápido

| Síntoma | Causa probable | Mitigación |
|---------|---------------|------------|
| `tools/list` directo devuelve `-32601 Method not found` | Falta el handshake `initialize` previo en stateless mode | No es bug; es protocolo. Clientes MCP reales lo hacen automático. Para curl, mandar `initialize` antes. |
| `401 Authentication required` | Header `Authorization` ausente o vacío | Verificá `BEARER` no esté vacío (`echo ${#BEARER}` debe dar 43). |
| `403 Invalid or revoked key` | Plaintext y hashes en `mcp-api-keys` se desincronizaron (rotación parcial) | Re-correr `bootstrap-mcp-api-keys.mjs --vault $KV` (rota ambos) y re-actualizar headers en todos los clientes. |
| Web responde 200 pero dice "no se pudo alcanzar al MCP server: timeout" | MCP scaled a 0 (poco probable hoy con `minReplicas: 1`) | `az containerapp update -n "$MCP_NAME" -g $RG --min-replicas 1`. |
| `containerapp exec` falla con `tty.setcbreak` | Estás en una shell sin TTY (CI, harness, etc.) | Usar terminal real. |
| `tools/list` devuelve `tools: []` | Boot del MCP falló en registrar las tools | `az containerapp logs show -n "$MCP_NAME" -g $RG --tail 100` y buscar `server.tool_registered` o errores. |

## 11. Alternativas no implementadas

Si en algún momento querés acotar la superficie sin romper el patrón actual:

- **Proxy en el web** (`web/src/app/api/mcp/route.ts`) que reenvíe POST al MCP con ingress interno. Permite layers extras (rate limiting, allowlist por IP, etc.) entre Internet y el MCP.
- **Private Endpoint + VNET integration**. Justificable solo en prod cuando bearer no alcance como gate.
