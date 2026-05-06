# Plan — Infra MCP Server (Cruce Chile MCP)

## Contexto

Aterrizar el spec de infra Azure (sección [Infra Azure](/Users/afroxstudio/.claude/plans/readme-md-analiza-las-ideas-cozy-ocean.md#infra-azure-spec-de-deployment)) en tareas verticales ejecutables. Resource Group `<rg>` (eastus) ya existe; falta todo lo demás.

**Alcance de este plan:** solo infra y CI/CD del MCP server. NO incluye la implementación de tools del MCP (check_blacklist, etc.) — eso queda para un plan posterior sobre Cluster B/C/D.

**Stack confirmado:**
- IaC: Bicep
- Hosting: Azure Container Apps (consumption)
- Containers: `mcp-server` (Node + TypeScript + `@modelcontextprotocol/sdk`) y `web` (Next.js)
- Registry: ACR Basic
- Secrets: Key Vault con managed identity (zero secrets en env vars)
- Cache: Storage Blob (3 containers: `cache-cmf`, `cache-rpsf`, `audit`)
- Observabilidad: Log Analytics + Application Insights
- CI/CD: GitHub Actions con OIDC federated credentials

---

## Dependency graph

```
[Slice 1: Bootstrap]
    │ providers + quotas + OIDC app registration
    ▼
[Slice 2: Bicep skeleton + Log Analytics] (App Insights diferido)
    │ workspace existe → sink de logs JSON de Container Apps listo
    ▼
[Slice 3: ACR + Storage + Key Vault]   ──┐
    │ artifact store + cache + secrets   │ (paralelos entre sí)
    ▼                                    ▼
[Slice 4: Container Apps Environment]
    │ env consume Log Analytics
    ▼
[Slice 5: Dockerfile mcp-server + first deploy]
    │ build → push ACR → Container App "ca-mcp" reachable (Streamable HTTP, ingress interno)
    │ managed identity con RBAC sobre Key Vault y Storage
    ▼
[Slice 6: Dockerfile web (Next.js) + first deploy]
    │ build → push ACR → Container App "ca-web" reachable
    │ ca-web llama a ca-mcp por DNS interno del env
    ▼
[Slice 7: Observabilidad end-to-end] (App Insights diferido)
    │ logs JSON de ambos containers visibles en Log Analytics
    │ hashing de inputs en logs aplicado (7.3); alertas diferidas
    ▼
[Slice 8: GitHub Actions CI/CD con OIDC]
    │ workflow build-and-deploy.yml verde en main
    ▼
[CHECKPOINT FINAL] → handover a equipo de app para Cluster B
```

## Estrategia de slicing

**Vertical, no horizontal.** Cada slice entrega algo desplegado y verificable end-to-end, no "todo el Bicep primero, luego todo el deploy". Esto permite cortar el plan en cualquier punto y tener algo funcional.

Excepción: Slice 1 (bootstrap) y Slice 2 (foundation telemetry) son prerequisitos atómicos sin valor de demo independiente — pero sí verificables por `az` CLI.

---

## Checkpoints (revisión humana obligatoria)

| Checkpoint | Cuándo | Qué validar |
|---|---|---|
| **CP-1** | Después de Slice 1 | Quotas OK, providers registrados, OIDC funciona contra suscripción. Sin estos, todo lo demás falla en silencio o tarde. |
| **CP-2** | Después de Slice 4 | Env desplegado y los recursos auxiliares (ACR/Storage/KV) responden. Punto natural para revisar costos en Azure Cost Mgmt. |
| **CP-3** | Después de Slice 6 | Stack completo reachable manualmente: `ca-web` público responde y renderiza el resultado del health interno de `ca-mcp`. La validación de latencia interna (<50 ms) se mide en CP-4, ahora vía Kusto sobre `ContainerAppConsoleLogs_CL` (App Insights diferido). |
| **CP-4** | Después de Slice 8 | CI/CD verde + telemetría llegando + latencia interna validada. Handover formal al equipo de app. |

---

## Riesgos identificados

- **Sponsorship con quotas limitadas.** `Pharmkt Sponsorship` puede tener regiones o vCPUs restringidas. Mitigación: validar en Slice 1 antes de escribir cualquier Bicep.
- **OIDC desde GitHub a Azure.** Configuración con muchas piezas (App Registration, Federated Credentials, RBAC). Mitigación: probar con un workflow trivial (`az account show`) antes del de deploy.
- **Costo descontrolado en demo.** Si el lab dispara mucho tráfico, Container Apps puede subir a $40–60. Mitigación: budget alert en Slice 1, scale-to-zero por defecto, max replicas bajo (3).
- **Imágenes con secretos accidentales.** Riesgo de leak en ACR. Mitigación: `.dockerignore` estricto, scan con `trivy` en CI antes del push.

---

## Out of scope (este plan no cubre)

- Implementación de las 7 tools del MCP (Cluster B, C, D del análisis).
- Cliente Next.js demo (UI, casos de uso 1 y 6) — solo se levanta un Next.js skeleton para validar deploy.
- Custom domain + cert. Se usa `*.azurecontainerapps.io` provisto por Azure.
- VNet integration / private endpoints. No aporta en demo.
- Pruebas de carga / chaos / DR. Demo, no producción.
- Roles RBAC granulares más allá de los necesarios para el demo.

---

## Verificación end-to-end (al cierre del plan)

Comandos que deben pasar después del último slice:

```bash
# Recursos desplegados
az resource list --resource-group <rg> --output table

# MCP server alcanzable solo desde dentro del env (no expuesto a internet)
# Verificación desde ca-web vía DNS interno; el FQDN externo no debe resolver públicamente.

# Web alcanzable y consumiendo MCP
curl -fsSL "https://ca-web-<env>.<env>.azurecontainerapps.io/"

# CI/CD verde (repo asumido <org>/<repo>; confirmar antes de Slice 1.4)
gh run list --repo <org>/<repo> --workflow build-and-deploy.yml --limit 1

# Telemetría llegando (logs JSON de Container Apps)
az monitor log-analytics query --workspace <log-fintech-<env>-id> \
  --analytics-query "ContainerAppConsoleLogs_CL | where TimeGenerated > ago(15m) and ContainerAppName_s in ('ca-mcp-<env>', 'ca-web-<env>') | take 5"
```

## Próximo paso

Trabajar `tasks/todo.md` slice por slice. No avanzar al siguiente slice sin pasar la verificación del actual.
