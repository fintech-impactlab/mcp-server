# Plan — MCP Authentication

## Contexto

Hoy `ca-mcp-${env}` corre con **ingress interno** (no expuesto a internet) y **sin autenticación**. Cualquier container dentro del CAE `cae-fintech-${env}` puede llamar al MCP. Esto es defensivamente débil:

- Asume que el CAE es un perímetro confiable. No lo es: cualquier nuevo Container App que se sume al env (legítimo o no) tiene acceso al MCP sin barreras.
- No prepara el terreno para los canales **post-lab** del [README.md](../README.md): extensión de navegador, app SMS, bot WhatsApp. Si esos consumen el MCP directamente (sin pasar por el web), el MCP necesitará exposición externa con auth fuerte.
- No hay forma de identificar **quién** invocó cada tool. La telemetría no distingue web vs extensión vs job.

**Outcome esperado:** todo request a `POST /mcp` (y futuros endpoints sensibles) requiere `Authorization: Bearer <api-key>` válido. `/health` sigue abierto para probes. Cada cliente tiene su key, identificable en telemetría, rotable sin downtime.

## Decisiones de diseño

- **Mecanismo: API key estática per-cliente, Bearer token en header `Authorization`.** Simple, ergonómico para clientes MCP (Claude Desktop, fetch programático), suficiente para defense-in-depth.
- **Almacén: Key Vault** (`kv-fintech-${env}-${suffix}`). Un secret JSON con array de keys + metadata. Cargado por el MCP al boot vía `@azure/keyvault-secrets` con UAI `uai-mcp-${env}`. Refresh in-process cada 60s.
- **Comparación: hash sha256 de la key + `crypto.timingSafeEqual`.** El secret en KV guarda solo hashes, nunca plaintexts. El plaintext se entrega al cliente una vez en el momento de creación.
- **Rotación: dos keys activas por cliente durante ventana.** Operador agrega key nueva (vieja sigue válida), update env var del cliente, espera propagación, marca vieja como `revokedAt`. Cero downtime.
- **Excluido de auth: `/health`.** Probes de Container Apps necesitan acceso sin credenciales.
- **Logging:** plaintext de key **nunca** entra a logs. Auth logs incluyen `clientId`, `keyId` (no plaintext), `inputHash` del header recibido (sha256:8) en caso de fallo.

**Alternativas evaluadas y descartadas:**

| Mecanismo | Por qué no |
|---|---|
| OAuth 2.1 / Entra ID | Overkill para demo. Cada cliente requiere App Registration. Reabrir si llegamos a auth empresarial. |
| MCP authorization spec (OAuth 2.1 client metadata) | Stack maduro pero complejo de implementar; el SDK aún tiene rough edges. Reabrir cuando estabilice o cuando integremos con Claude Desktop sin config manual. |
| mTLS | Container Apps no expone terminación mTLS simple. Operacionalmente pesado. |
| HMAC firmas por request | Más seguro (replay-resistant) pero suma fricción al cliente. Reabrir si el endpoint llega a ser realmente público. |
| IP allowlist en ingress | Endpoint es interno; no aplica. Para futuro endpoint externo, sería complemento de Bearer, no reemplazo. |

---

## Dependency graph

```
[Slice A1: Auth en código del MCP server]
    │ - Middleware Express auth
    │ - Key store con cache 60s desde KV
    │ - Validación timing-safe
    │ - Logging hasheado
    │ - Tests unitarios + integración con KV mock
    ▼
[Slice A2: Infra — KV secret + secretRef en ca-mcp]
    │ - Secret `mcp-api-keys` en KV (creado out-of-Bicep, valor inicial bootstrap)
    │ - Bicep: pasar secrets[] + secretEnvVars[] al módulo mcpApp
    │ - Deploy + smoke test (401 sin auth, 200 con auth válido)
    ▼
[CP-Auth-1] MCP rechaza requests sin auth válido
    │
    ▼
[Slice A3: Web client envía Authorization]
    │ - Secret `mcp-api-key-web` (plaintext de la key del cliente "web")
    │ - RBAC: uai-web-${env} con Key Vault Secrets User scoped al secret
    │ - Bicep: secretRef en ca-web
    │ - app/page.tsx con header Authorization
    ▼
[CP-Auth-2] flujo end-to-end web→MCP autenticado
    │
    ▼
[Slice A4: Telemetría + procedimiento de rotación]
    │ - clientId en payload de log `tool.call`
    │ - custom event auth.failure
    │ - docs/KEY_ROTATION.md
    │ - script opcional pnpm rotate-key <clientId>
```

---

## Estrategia de slicing

**A1 antes que A2.** El código debe estar listo y testeado antes de tocar infra. La validación corre contra fixtures locales (sin KV real) hasta el deploy de A2.

**A2 antes que A3.** El MCP debe rechazar requests sin auth antes de que el web empiece a enviarlos — si no, hay ventana de regresión.

**A3 con feature flag.** Para evitar downtime de `ca-web` durante el roll-out, el web envía el header solo si la env var `MCP_API_KEY` existe. Con eso podemos: (1) deployar el MCP con auth obligatoria + un valor inicial conocido, (2) deployar el web con la env var seteada, (3) verificar end-to-end.

---

## Checkpoints

| Checkpoint | Cuándo | Qué validar |
|---|---|---|
| **CP-Auth-1** | Después de Slice A2 | Request a `POST /mcp` desde un container temporal del CAE sin `Authorization` retorna 401. Con un Bearer válido, retorna 200 (`tools/list` vacío en bootstrap). `/health` sigue retornando 200 sin auth. |
| **CP-Auth-2** | Después de Slice A3 | El web público (`https://ca-web-...`) renderiza el resultado del MCP normalmente. Si se quita la env var `MCP_API_KEY` y se redeploya el web, la página muestra estado degradado (200 con mensaje de error) — no propaga 5xx. |

---

## Riesgos

- **Brute-force sobre el endpoint.** Mitigación: timing-safe compare (no info leakage), rate limit a nivel ingress de Container Apps en una iteración posterior, alerta en Log Analytics (Kusto query schedulada) cuando `auth.failure` excede 10/min sostenido.
- **Leak de plaintext en logs.** Mitigación: política dura — solo `clientId` + `keyId` + `inputHash` en logs. Test que captura logger output y verifica que no aparece el header completo.
- **Downtime durante rotación si está mal hecha.** Mitigación: soportar 2+ keys activas por cliente; doc de rotación con orden estricto de pasos.
- **Cache stale tras revocación.** TTL del cache es 60s — una key revocada sigue siendo aceptada hasta 60s después del update en KV. Aceptable; documentado. Para revocación de emergencia, restart del Container App fuerza reload inmediato (`az containerapp revision restart`).
- **`uai-web-${env}` con acceso a KV.** Hoy `uai-web-${env}` solo tiene `AcrPull`. Sumar `Key Vault Secrets User` aumenta blast radius del web. Mitigación: scope al secret específico (`mcp-api-key-web`), no al vault completo.

---

## Out of scope (este plan no cubre)

- OAuth 2.1 / Entra ID flow.
- MCP authorization spec del protocolo (OAuth 2.1 client metadata).
- Rate limiting (slice futuro si es necesario, soportado por ingress de Container Apps).
- mTLS.
- Auditoría inmutable de auth events más allá de los Console Logs estándar (si llegamos a compliance, mover a Storage append-only o tabla LA dedicada con retention extendida).
- Auth multi-tenant para futura federación de clientes externos.

---

## Verificación end-to-end (al cierre)

```bash
# 1. Sin auth → 401
curl -i -X POST http://<ca-mcp-internal>/mcp -d '{}' -H "Content-Type: application/json"
# HTTP/1.1 401 Unauthorized

# 2. Auth inválida → 403
curl -i -X POST http://<ca-mcp-internal>/mcp -d '{}' \
  -H "Content-Type: application/json" -H "Authorization: Bearer wrong-key"
# HTTP/1.1 403 Forbidden

# 3. Auth válida → 200 (con tools/list vacío en bootstrap)
KEY=$(az keyvault secret show --name mcp-api-key-web --vault-name <kv> --query value -o tsv)
curl -i -X POST http://<ca-mcp-internal>/mcp \
  -H "Content-Type: application/json" -H "Authorization: Bearer $KEY" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# HTTP/1.1 200 OK

# 4. /health sin auth → 200
curl -i http://<ca-mcp-internal>/health
# HTTP/1.1 200 OK

# 5. Ningún plaintext en logs
az monitor log-analytics query --workspace <log-fintech-${env}-id> \
  --analytics-query "ContainerAppConsoleLogs_CL | where TimeGenerated > ago(1h) | where Log_s contains 'Bearer ' | take 10"
# Esperado: 0 filas

# 6. clientId visible en tool.call
az monitor log-analytics query --workspace <log-fintech-${env}-id> \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'ca-mcp-fintech-${env}' | extend log = parse_json(Log_s) | where log.event == 'tool.call' | summarize count() by tostring(log.clientId)"
# Esperado: filas por clientId (web, dev, etc.)

# 7. auth.failure event presente
az monitor log-analytics query --workspace <log-fintech-${env}-id> \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'ca-mcp-fintech-${env}' | extend log = parse_json(Log_s) | where log.event == 'auth.failure' | take 10"
# Esperado: filas si hubo intentos fallidos durante el smoke test
```

## Próximo paso

Trabajar [tasks/todo-auth.md](todo-auth.md) slice por slice. A1 puede arrancar en paralelo con [Slice 0 de plan-tools.md](plan-tools.md) — son independientes.
