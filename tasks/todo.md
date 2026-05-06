# TODO — Infra MCP Server

> Spec: `tasks/plan.md` · Análisis: `/Users/afroxstudio/.claude/plans/readme-md-analiza-las-ideas-cozy-ocean.md`
> Convención: cada tarea tiene **AC** (acceptance criteria) y **Verify** (cómo probar). No marcar `[x]` sin pasar Verify.

---

## Slice 1 — Bootstrap & validaciones

Sin esto, los slices siguientes fallan tarde. Pura preparación.

- [x] **1.1** Registrar providers Azure necesarios. ✅ 2026-05-05
  - **AC:** providers `Microsoft.App`, `Microsoft.OperationalInsights`, `Microsoft.Insights`, `Microsoft.ContainerRegistry`, `Microsoft.Storage`, `Microsoft.KeyVault` en estado `Registered`.
  - **Verify:** `for p in Microsoft.App Microsoft.OperationalInsights Microsoft.Insights Microsoft.ContainerRegistry Microsoft.Storage Microsoft.KeyVault; do az provider show -n $p --query registrationState -o tsv; done` → 6× `Registered`. (Nota: `az provider list` oculta `Microsoft.Insights`, usar `az provider show` per-provider.)

- [x] **1.2** Validar quotas de la suscripción para Container Apps en eastus. ✅ 2026-05-05
  - **AC:** Container Apps soportado en eastus + quota de `ManagedEnvironmentCount` disponible. (Consumption no expone quota de vCPU a nivel suscripción; el límite es por replica: 4 vCPU/8 GiB.)
  - **Verify:** `az provider show -n Microsoft.App --query "resourceTypes[?resourceType=='managedEnvironments'].locations[]" -o tsv | grep "East US"` → `East US`. `az rest --method get --url "https://management.azure.com/subscriptions/<sub>/providers/Microsoft.App/locations/eastus/usages?api-version=2024-03-01"` → `ManagedEnvironmentCount` 0/50.
  - **Side effect:** registrado provider `Microsoft.Quota` (no usado al final, queda registrado).

- [x] **1.3** Crear App Registration para OIDC desde GitHub Actions. ✅ 2026-05-06
  - **AC:** App Registration `gh-fintech-mcp-deployer` existe; Service Principal asociado con rol `Contributor` sobre el RG (acotar después con custom role en 8.5).
  - **Verify:** `az ad app list --display-name gh-fintech-mcp-deployer --query "[].appId" -o tsv` devuelve un appId; `az role assignment list --assignee <appId> --resource-group <rg>` muestra `Contributor`.
  - **IDs producidos:** los identificadores (clientId, tenantId, subscriptionId, objectId del SP) **no se commitean**. Viven solo en GitHub repo variables (Settings → Secrets and variables → Actions → Variables) y en `.env.local`.

- [x] **1.4** Configurar federated credential para repo y branch `main` + PRs. ✅ 2026-05-06
  - **AC:** dos federated credentials: una con subject `repo:<org>/<repo>:ref:refs/heads/main` y otra con `repo:<org>/<repo>:pull_request`.
  - **Verify:** `az ad app federated-credential list --id <appId> --query "[].{name:name,subject:subject}" -o table` lista las dos.

- [~] **1.5** ~~Configurar budget alert en el RG~~ — **NO APLICA**. ⚠️ 2026-05-06
  - **Blocker:** la suscripción del proyecto (offer Sponsorship `MS-AZR-0036P`) no soporta Cost Management API. Tanto `az consumption budget list/show` como PUT vía REST fallan con `400 Cost Management supports only Enterprise Agreement, Web direct and Microsoft Customer Agreement offer types`.
  - **Mitigación adoptada:** caps duros en infra (scale-to-zero, `maxReplicas: 3`, `cpu: 0.5`, `memory: 1Gi`) en Slices 5.5/6.3 + monitoreo manual del balance en `https://sponsorships.microsoft.com`.
  - **Diferida:** ver 1.5b si se requiere chequeo programático.

- [ ] **1.5b** *(opcional, diferida)* Workflow GitHub Actions de monitoreo de costo acumulado.
  - **AC:** workflow scheduled (cron diario) que ejecuta `az consumption usage list` filtrado por RG y publica el acumulado del mes; si supera $30 o $50, falla el run y dispara notificación.
  - **Verify:** un run manual con umbral artificial bajo ($1) confirma que la notificación llega.
  - **Activar solo si:** el demo se extiende más allá de 2 semanas o el balance del sponsorship empieza a bajar rápido.

> ⛳ **Checkpoint CP-1** — antes de continuar, revisar: quotas OK, providers OK, OIDC funcionando con un `az account show` desde un workflow trivial.

---

## Slice 2 — Bicep skeleton + telemetría base

- [ ] **2.1** Crear estructura `infra/` con módulos vacíos.
  - **AC:** árbol propuesto en spec creado: `infra/main.bicep`, `infra/modules/{log-analytics,container-apps-env,container-app,acr,storage,key-vault}.bicep`, `infra/parameters/dev.bicepparam`. Sin `app-insights.bicep` (diferido — ver 2.3).
  - **Verify:** `find infra -name "*.bicep" -o -name "*.bicepparam" | wc -l` ≥ 8.

- [ ] **2.2** Implementar módulo `log-analytics.bicep`.
  - **AC:** crea Log Analytics Workspace `log-fintech-dev` (PerGB2018, retention 30d).
  - **Verify:** `az monitor log-analytics workspace show -g <rg> -n log-fintech-dev --query "provisioningState" -o tsv` → `Succeeded`.

- [~] **2.3** ~~Implementar módulo `app-insights.bicep` (workspace-based)~~ — **NO APLICA POR AHORA.**
  - **Decisión:** sin App Insights por ahora. Telemetría vía logs JSON estructurados a stdout → Container Apps Console Logs → Log Analytics workspace de 2.2. Ver [SPEC § 2 / § 6.4](../SPEC.md) y [tasks/plan-auth.md](plan-auth.md).
  - **Reabrir si:** llega requerimiento de APM detallado / Live Metrics, los logs de LA no alcanzan para correlación distribuida, o se suma OpenTelemetry y AI es el sink natural.

- [ ] **2.4** Cablear `main.bicep` para invocar 2.2, deploy. Ajustar `cae` (Slice 4.1) para apuntar `appLogsConfiguration` al workspace de 2.2 cuando 2.2 cierre.
  - **AC:** `az deployment group create` retorna `Succeeded`. `cae-<env>` configurado con `appLogsConfiguration.destination='log-analytics'` y customer ID + shared key del workspace.
  - **Verify:** `az deployment group list -g <rg> --query "[0].properties.provisioningState"` → `Succeeded`. `az containerapp env show -n cae-<env> --query "properties.appLogsConfiguration.destination" -o tsv` → `log-analytics`. Logs de stdout de `ca-mcp` aparecen en `ContainerAppConsoleLogs_CL` de la workspace.

---

## Slice 3 — ACR + Storage + Key Vault (paralelos entre sí)

> Nota: Slice 2 (Log Analytics + App Insights) saltado por decisión del usuario para acelerar el MCP. Slice 4 desplegará CAE con `appLogsConfiguration: null`. Telemetría se retoma cuando se priorice.

- [x] **3.1** Implementar módulo `acr.bicep`. ✅ 2026-05-06
  - **AC:** ACR `<acr-name>` (Basic, admin disabled). Anonymous pull no aplica a SKU Basic (propiedad rechazada por ARM).
  - **Verify:** `sku=Basic`, `adminUserEnabled=false`, tags `{project,env,owner,managedBy}` presentes.
  - **Side note:** se agregó `uniqueString` al nombre del ACR (no estaba en spec original) porque `<acr>` ya estaba tomado globalmente.

- [x] **3.2** Implementar módulo `storage.bicep` con 3 blob containers. ✅ 2026-05-06
  - **AC:** Storage `<storage-name>` (Standard_LRS, Hot, TLS 1.2, public blob access off). Containers `cache-cmf`, `cache-rpsf`, `audit` creados.
  - **Verify:** `az storage container list ... --auth-mode login` → 3 containers.

- [x] **3.3** Implementar módulo `key-vault.bicep` (RBAC mode). ✅ 2026-05-06
  - **AC:** KV `<kv-name>` con RBAC=true, soft-delete 7d, purge protection off.
  - **Verify:** `enableRbacAuthorization=true`, `softDeleteRetentionInDays=7`.

- [x] **3.4** Cablear módulos en `main.bicep` y deploy incremental. ✅ 2026-05-06
  - **AC:** 3 recursos provisionados (sin Workspaces/AppInsights por skip de Slice 2).
  - **Verify:** `az resource list -g <rg>` → 3 recursos: registries + storageAccounts + vaults.

- [x] **3.5** Tagging consistente en todos los módulos Bicep. ✅ 2026-05-06
  - **AC:** tags `{project, env, owner, managedBy}` propagados desde `main.bicep`. Valores concretos en `dev.bicepparam` (no commiteados los individuos).
  - **Verify:** `az resource list -g <rg> --query "[?tags.project!='fintech-mcp'].name" -o tsv` → vacío.

---

## Slice 4 — Container Apps Environment

- [x] **4.1** Implementar módulo `container-apps-env.bicep`. ✅ 2026-05-06
  - **AC:** env `cae-<env>` Consumption-only, sin `appLogsConfiguration` (logs solo vía control plane). Log Analytics se cableará al retomar Slice 2.
  - **Verify:** `provisioningState=Succeeded`, `defaultDomain` y `staticIp` retornados por `az containerapp env show` (valores guardados fuera del repo).

- [x] **4.2** Cablear en `main.bicep` y deploy. ✅ 2026-05-06
  - **AC:** deploy idempotente (re-run sin cambios).
  - **Verify:** segundo `az deployment group create` ejecutó en 4s sin cambios.

> ⛳ **Checkpoint CP-2** — Cost Mgmt no aplica en Sponsorship (ver 1.5). Revisar manualmente en https://sponsorships.microsoft.com si el balance bajó significativamente.

---

## Slice 5 — `mcp-server` end-to-end (primer vertical real)

Este slice cierra el primer recorrido completo: código → imagen → registry → container app → URL interna responde.

> **Decisión de diseño:** se usa **User-Assigned Managed Identity** (`uai-mcp-<env>`) en lugar de system-assigned, para evitar el bootstrap circular ACR↔identity (la UAI obtiene `AcrPull` antes de crear el Container App, así el primer pull funciona). El `system-assigned` queda fuera.

- [x] **5.1** Estructura mínima del paquete `mcp-server/`. ✅ 2026-05-06
  - **AC:** `package.json` con `@modelcontextprotocol/sdk@1.29.0` + `express@4.21.2`, `tsconfig.json` con `strict: true` + `noUncheckedIndexedAccess`, src/index.ts con `GET /health` y `POST /mcp` (Streamable HTTP, stateless). **Package manager: pnpm 10.33.0** (no npm).
  - **Verify:** `pnpm typecheck` y `pnpm build` pasan; smoke test local con `node dist/index.js` + `curl /health` → `{"status":"ok","name":"fintech-mcp","version":"0.1.0"}`.

- [x] **5.2** Dockerfile multi-stage para `mcp-server`. ✅ 2026-05-06
  - **AC:** 3 stages (`builder` → `deps` → `runtime`), base `node:22-alpine` (subido desde `node:20-alpine` por 11 CVEs high), pnpm vía corepack, `USER node` no-root. Final image **60.3 MB** (< 200 MB AC).
  - **Verify:** `docker run` local responde 200 en `/health`.

- [x] **5.3** Push de imagen a ACR. ✅ 2026-05-06
  - **AC:** tag `mcp-server:bootstrap` en `<acr-name>.azurecr.io`. Login vía `az acr login` (admin off, OK).
  - **Verify:** `az acr manifest list-metadata` muestra el tag.

- [x] **5.4** Implementar módulo `container-app.bicep` parametrizable. ✅ 2026-05-06
  - **AC:** params: name, image, port, minReplicas, maxReplicas, envVars, secrets, secretEnvVars, environmentId, acrLoginServer, userAssignedIdentityId, external. Reutilizable para web (Slice 6).
  - **Verify:** `az bicep build` sin errores.

- [x] **5.5** Deploy `ca-mcp-<env>`. ✅ 2026-05-06
  - **AC:** Container App con 0.5 vCPU / 1 GiB, 0–3 réplicas, **ingress interno** (`external: false`), `targetPort: 3001`. FQDN: `ca-mcp-<env>.internal.<cae-default-domain>`.
  - **Verify:** revisión `Healthy`, replica `Running`, console log `listening on :3001`. Smoke test end-to-end vía Container App Job ephemeral en el mismo CAE: `curl http://ca-mcp-<env>/health` → `{"status":"ok",...}` + `SMOKE_OK`.

- [x] **5.6 + 5.7** RBAC: UAI con AcrPull (ACR) + Key Vault Secrets User (KV) + Storage Blob Data Contributor (Storage). ✅ 2026-05-06
  - **AC:** los 3 role assignments creados sobre los recursos correctos (no a nivel RG).
  - **Verify:** `az role assignment list --assignee <uai-principalId> --all` muestra los 3 roles + scopes correctos. AcrPull validado implícitamente por el primer pull exitoso del Container App (admin de ACR está off).
  - **Side note:** GUIDs de roles built-in tuvieron 2 errores en el primer intento (AcrPull y Storage Blob Contributor); corregidos contra `az role definition list`.

---

## Slice 6 — `web` end-to-end

- [x] **6.1** Estructura mínima `web/` (Next.js 15 + App Router). ✅ 2026-05-06
  - **AC:** `web/` con `next@15.0.3` + `react@18.3.1`, TypeScript estricto + `noUncheckedIndexedAccess`, Server Component (`page.tsx`) con `dynamic = 'force-dynamic'` que hace fetch al `/health` del MCP con `cache: 'no-store'` y timeout 2s. Sin ESLint inicial (se añadirá en Slice 8). **Package manager: pnpm.**
  - **Verify:** `pnpm typecheck` y `pnpm build` pasan; `next build` reporta `/` como `ƒ Dynamic`.

- [x] **6.2** Dockerfile para `web` (output standalone de Next.js). ✅ 2026-05-06
  - **AC:** `next.config.mjs` con `output: 'standalone'`, multi-stage `node:22-alpine` + pnpm via corepack, USER node no-root, **70.8 MB** (mucho menos que los ~150 MB esperados).
  - **Verify:** `docker run` local con `MCP_URL=http://host.docker.internal:3098` apuntando al MCP local renderiza la página con `status=ok` y `latencia=81 ms`.
  - **Side note:** primer build falló por `ENV NODE_ENV=development` antes de `next build` (rompió prerender de `/404`); fix: setear `NODE_ENV=production` solo justo antes de `pnpm run build`.

- [x] **6.3** Push imagen a ACR + deploy `ca-web-<env>`. ✅ 2026-05-06
  - **AC:** tag `web:bootstrap` en ACR. Container App con 0.5 vCPU / 1 GiB, 0–3 réplicas, **ingress externo HTTPS** en 3000. UAI separada (`uai-web-<env>`) con solo `AcrPull` (web no toca KV ni Storage).
  - **Verify:** `https://ca-web-<env>.<cae-default-domain>/` → 200, página renderiza el placeholder con datos del MCP.

- [x] **6.4** DNS interno entre containers. ✅ 2026-05-06
  - **AC:** ca-web consume `MCP_URL=http://ca-mcp-<env>` (FQDN corto, sin `.azurecontainerapps.io`). Resolución por DNS interno del CAE.
  - **Verify:** página renderiza `latencia: 10 ms` (LAN interna del env, vs 81 ms cuando se probó local con host.docker.internal). Curl directo al FQDN público de ca-mcp retorna 404 (no expuesto a internet).

> ⛳ **Checkpoint CP-3** — ✅ Stack completo reachable. ca-web público responde 200 con datos del MCP; ca-mcp NO expuesto públicamente. Latencia interna 10 ms (validada antes de App Insights, satisface el AC).

---

## Slice 7 — Observabilidad

> **Decisión:** sin App Insights por ahora. Telemetría vía logs JSON estructurados a stdout → Container Apps Console Logs → Log Analytics workspace `log-fintech-<env>` (Slice 2.2). Ver [SPEC § 2 / § 6.4](../SPEC.md). Las tareas de App Insights (7.0, 7.1, 7.2, 7.4) quedan diferidas.

- [~] **7.0** ~~Seed del secret `appinsights-connection-string` en Key Vault~~ — **NO APLICA POR AHORA.**
  - **Reabrir si:** se decide retomar App Insights.

- [~] **7.1** ~~Wirear App Insights connection string vía Key Vault secret en ambos containers~~ — **NO APLICA POR AHORA.**

- [~] **7.2** ~~SDK de App Insights inicializado en `mcp-server`~~ — **NO APLICA POR AHORA.**
  - **Reemplazo:** `mcp-server/src/lib/logging.ts` expone `logger.event(name, payload)` que emite JSON Lines a stdout. Container Apps captura stdout y lo envía a `log-fintech-<env>` (vía `appLogsConfiguration` cableada en Slice 2.4). Implementación cubierta por [tasks/plan-tools.md Slice 0.3](plan-tools.md) y [tasks/plan-auth.md Slice A1.5](plan-auth.md).

- [ ] **7.3** Hashing de inputs sensibles en logs.
  - **AC:** función `hashInput(s)` retorna `sha256(s).slice(0,8)`; usada en todos los logs de tool inputs. Test unitario confirma que el output nunca es reversible. Aplica al sink stdout JSON, sin importar que App Insights esté diferido.
  - **Verify:** `grep -rE "console\.log\(|logger\." mcp-server/src` no muestra inputs raw; los que loguean RUT/URL/dominio pasan por `hashInput`.

- [~] **7.4** ~~Alerta de error rate en App Insights~~ — **NO APLICA POR AHORA.**
  - **Reemplazo (cuando se priorice):** alerta scheduled query en Log Analytics (Kusto sobre `ContainerAppConsoleLogs_CL`) con criterio equivalente: ratio de logs `level == "error"` > 5% en ventana 10 min. Tarea separada cuando se retome observabilidad.

---

## Slice 8 — CI/CD con OIDC

- [x] **8.1** Workflow `build-and-deploy.yml` con jobs paralelos `mcp-server` y `web`. ✅ 2026-05-06
  - **AC:** trigger en push a `main` y en PR. Cada job declara `permissions: { id-token: write, contents: read }`. Steps: checkout → docker buildx → trivy scan → OIDC login → ACR login → push tag `<sha>` + `latest` → `az containerapp update --image` → verify revision Healthy.
  - **Verify:** run `25420576231` (commit `5f3d226`) verde end-to-end, deploy de ambas revisiones nuevas. URL pública responde 200.
  - **Side note:** `vars.*` reemplazado por `secrets.*` (los 8 valores como secrets); matrix indirection cambió de `vars[matrix.x]` a `case` en bash porque GitHub Actions no soporta `secrets[expr]` dinámico.

- [x] **8.2** Scan de imagen con `trivy` antes del push. ✅ 2026-05-06
  - **AC:** step `aquasecurity/trivy-action@v0.36.0` con `severity: CRITICAL,HIGH`, `exit-code: 1`, `ignore-unfixed: true`, `vuln-type: 'os,library'`. Mismas settings ejecutables localmente con `trivy image ...`.
  - **Verify:** Trivy local exit 0 en ambos `mcp-server:bootstrap` y `web:bootstrap`; CI scan también en verde.
  - **Fixes aplicados:** runtime stage hace `apk upgrade --no-cache` (musl/zlib/openssl HIGH); npm/yarn/corepack removidos del runtime (eliminan picomatch + tinyglobby vulnerables del bundle de npm CLI); `next 15.5.7 → 15.5.15` (3 GHSAs DoS).

- [x] **8.3** Type check + build en CI antes del build de imagen. ✅ 2026-05-06
  - **AC:** job `validate` (matrix mcp-server + web) corre `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`. `build-and-deploy` depende de `validate` (no arranca si falla). Lint y tests no añadidos en este slice (sin ESLint/Vitest config aún; queda en plan-tools).
  - **Verify:** matrix `validate (mcp-server)` y `validate (web)` en verde en run `25420576231`.

- [ ] **8.4** Branch protection en `main`.
  - **AC:** require status checks: `validate (mcp-server)`, `validate (web)`, `build-and-deploy (mcp-server)`, `build-and-deploy (web)`. Require PR review (al menos 1).
  - **Verify:** `gh api repos/<org>/<repo>/branches/main/protection` muestra los checks requeridos.

- [ ] **8.5** Acotar SP `gh-fintech-mcp-deployer` con custom role (cierra TODO de 1.3).
  - **AC:** custom role definido con permisos mínimos (`Microsoft.App/containerApps/*`, `Microsoft.ContainerRegistry/registries/push/write`, `Microsoft.ContainerRegistry/registries/pull/read`, `Microsoft.Resources/deployments/*` sobre el RG). Reasignar al SP y remover `Contributor`.
  - **Verify:** `az role assignment list --assignee <appId> --resource-group <rg> --query "[].roleDefinitionName" -o tsv` ya no muestra `Contributor`. Re-ejecutar el workflow `build-and-deploy.yml` confirma que el SP recortado sigue siendo suficiente.
  - **Alternativa:** mover a out-of-scope si el demo cierra antes; documentar la deuda en plan.md.

> ⛳ **Checkpoint CP-4 (final)** — handover formal. Validar también: logs JSON de `ca-mcp` y `ca-web` visibles en Log Analytics workspace `log-fintech-<env>` y latencia interna `ca-web` → `ca-mcp` < 50 ms (métrica que se difiere desde CP-3, ahora medible vía Kusto sobre `ContainerAppConsoleLogs_CL`). El equipo de app puede empezar Cluster B sobre infra estable.

---

## Verificación end-to-end (todos los slices completos)

```bash
# 1. Recursos
az resource list -g <rg> -o table
# Esperado: 7+ recursos (Workspace, AppInsights, ACR, Storage, KV, CAE, 2× Container Apps)

# 2. URLs reachable
# ca-mcp es interno: probar desde un job temporal dentro del env
az containerapp exec -n ca-web-<env> -g <rg> --command "curl -fsSL http://ca-mcp-<env>/health"
curl -fsSL https://ca-web-<env>.<env-fqdn>/

# 3. CI verde
gh run list --repo <org>/<repo> --limit 1 --json conclusion --jq '.[0].conclusion'
# Esperado: "success"

# 4. Telemetría (logs JSON de Container Apps)
az monitor log-analytics query --workspace <log-fintech-<env>-id> \
  --analytics-query "ContainerAppConsoleLogs_CL | where TimeGenerated > ago(1h) and ContainerAppName_s in ('ca-mcp-<env>', 'ca-web-<env>') | summarize count() by ContainerAppName_s"

# 5. Sin secretos en repo
git log --all -p | grep -iE "(api[_-]?key|secret|password|connection.?string)" | grep -v "example\|placeholder" || echo "OK"

# 6. Costo bajo control
az consumption usage list --start-date $(date -u -v-7d +%Y-%m-%d) --end-date $(date -u +%Y-%m-%d) \
  --query "[?contains(instanceName,'fintech')].pretaxCost" -o tsv | awk '{s+=$1} END {print s}'
# Esperado: <$5 acumulado semana
```
