# Secretos del MCP

Todos los secretos viven en Azure Key Vault y se inyectan al Container App vía
`secretRef` (ver [`infra/main.bicep`](../infra/main.bicep)). El UAI
`uai-mcp-fintech-<env>` tiene rol `Key Vault Secrets User` vault-wide
(ver [`infra/modules/mcp-identity.bicep`](../infra/modules/mcp-identity.bicep)),
así que basta con seedear el secret en KV para que la siguiente revisión lo
levante.

## Secrets activos

| Secret | Bicep `secretRef` | Env var | Activa qué |
|--------|-------------------|---------|------------|
| `mcp-api-keys` | `mcp-api-keys` | `MCP_API_KEYS_SECRET` | Auth Bearer del MCP. Sin esto el server no boot. |
| `storage-account-key` | (consumido por jobs/upload) | n/a | Permite a `upload-data-to-share.mjs` escribir al File Share. |
| `anthropic-api-key` | `anthropic-api-key` | `ANTHROPIC_API_KEY` | `smart_evaluation`. Si está vacío o es placeholder (no empieza con `sk-ant-`), la tool **no se registra** y el resto del MCP funciona normalmente. |

## Seedear / rotar `anthropic-api-key`

```bash
KV=kv-fintech-dev-ic66pjdlb

# 1. Crear o rotar el secret. Reemplazá <KEY> por la API key real
#    obtenida en https://console.anthropic.com/settings/keys
az keyvault secret set --vault-name $KV --name anthropic-api-key --value '<KEY>' --output none

# 2. Forzar nueva revisión del Container App para que pickee el secret
az containerapp revision restart -n ca-mcp-fintech-dev -g oarocha-fintech --output none

# 3. Verificar en logs que la tool se registró
az containerapp logs show -n ca-mcp-fintech-dev -g oarocha-fintech --tail 30 --format text \
  | grep -E 'anthropic_ready|tool_registered.*smart_evaluation'
```

Si la key vieja queda comprometida: revocala en
<https://console.anthropic.com/settings/keys> antes de rotar el secret en KV.

## Verificación rápida

```bash
# ¿Está seteado el secret?
az keyvault secret show --vault-name $KV --name anthropic-api-key --query attributes.enabled

# ¿Lo está consumiendo el Container App?
az containerapp show -n ca-mcp-fintech-dev -g oarocha-fintech \
  --query "properties.template.containers[0].env[?name=='ANTHROPIC_API_KEY']"
```

## Convenciones

- **Nunca** commitear el valor real al repo (incluyendo este archivo).
- **Nunca** loguear la key cruda. El wrapper `lib/anthropic.ts` ya lo evita —
  los logs `claude.call` no incluyen el contenido del prompt ni la key.
- Si necesitás un valor distinto en local, usá `.env.local` (gitignored).
