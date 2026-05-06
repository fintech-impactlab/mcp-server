# TODO — MCP Authentication

> Spec: [tasks/plan-auth.md](plan-auth.md) · SPEC: [SPEC.md](../SPEC.md)
> Convención: cada tarea tiene **AC** (acceptance criteria) y **Verify** (cómo probar). No marcar `[x]` sin pasar Verify.

---

## Slice A1 — Auth en código del MCP server

Trabajo puramente en `mcp-server/src/`. No toca infra. Verificable con tests + KV mockeado.

- [x] **A1.1** Definir formato de keys + estructura del secret KV.
  - **AC:** decisión documentada en `mcp-server/CONVENTIONS.md` (a crear): keys son strings ≥32 bytes random URL-safe (`crypto.randomBytes(32).toString('base64url')`). Secret `mcp-api-keys` en KV es JSON con shape:
    ```json
    [
      { "clientId": "web", "keyId": "k-2026-05-01", "keyHash": "<sha256-base64url>", "createdAt": "2026-05-01T00:00:00Z", "revokedAt": null },
      { "clientId": "dev", "keyId": "k-2026-05-01-dev", "keyHash": "...", "createdAt": "...", "revokedAt": null }
    ]
    ```
  - **Verify:** `mcp-server/CONVENTIONS.md` tiene la sección "Authentication" con el shape JSON y la regla "plaintext nunca persiste".

- [x] **A1.2** Helper `hashKey(plain)` + `validateKey(plain, knownHashes[])`.
  - **AC:** `mcp-server/src/server/auth/keys.ts`. `hashKey` retorna sha256 base64url. `validateKey` itera la lista y compara con `crypto.timingSafeEqual` sobre los buffers de los hashes. Retorna `{ valid: true, clientId, keyId } | { valid: false }`.
  - **Verify:** `pnpm test` con tests del módulo: key válida → match, key inválida → no-match, key revocada (`revokedAt != null`) → no-match, plaintext con padding diferente al original → no-match. Test específico de `timingSafeEqual` confirma que se llama (mock).

- [x] **A1.3** Key store con cache 60s desde KV.
  - **AC:** `mcp-server/src/server/auth/key-store.ts`. Clase `KeyStore` con método `getActiveKeys(): Promise<KeyEntry[]>` que cachea 60s en memoria. Carga vía `@azure/keyvault-secrets` + `DefaultAzureCredential` (UAI `uai-mcp-${env}` en runtime, `az login` en dev). En fallo de KV, retorna último valor conocido y loggea warning. Si nunca cargó y KV cae, lanza `AuthBootstrapError` que abortará el boot.
  - **Verify:** test con mock de `SecretClient`: primera carga llama KV; segundas N llamadas en <60s no llaman KV; llamada >60s refresca; KV failure tras carga exitosa → último valor; KV failure sin carga previa → throw.

- [x] **A1.4** Middleware Express `requireBearer`.
  - **AC:** `mcp-server/src/server/middleware/auth.ts`. Lee `Authorization: Bearer <plain>`. Sin header → 401 con body JSON-RPC `{ error: { code: -32001, message: "Authentication required" }, id: null }`. Header presente pero `validateKey` falla → 403 con `{ error: { code: -32002, message: "Invalid or revoked key" }, id: null }`. Pone `req.auth = { clientId, keyId }` cuando es válido. Agregado al pipeline solo en `POST /mcp`. **No** se aplica a `/health` ni `GET /mcp` (este último ya retorna 405 propio).
  - **Verify:** tests de integración con `supertest`: sin header → 401, header inválido → 403, header válido con key revocada → 403, header válido + `/mcp` POST → handler MCP corre normal, `/health` GET → 200 sin importar auth.

- [x] **A1.5** Logging hasheado de auth events.
  - **AC:** ningún log incluye el plaintext del header. En éxito **no se emite log dedicado** (la auth exitosa queda implícita en el log `tool.call` con `clientId`). En fallo, log JSON `{ event: "auth.failure", reason: "no_header" | "invalid_key" | "revoked", inputHash, ip? }` donde `inputHash = hashInput(authHeader ?? "")`. Emitido vía `logger.event` (helper de Slice 0.3 de tools, o adelantar acá si es necesario).
  - **Verify:** test que captura todos los `console.*` del flujo auth y verifica con `expect(stdout).not.toContain('Bearer ')` (con espacio para evitar falsos positivos del literal de error). Test específico verifica que el JSON de `auth.failure` no incluye campo `key`, `bearer` ni el header completo.

- [x] **A1.6** Wirear el middleware en `src/index.ts`.
  - **AC:** `mcp-server/src/index.ts` actualizado: instancia `KeyStore` al boot, espera primera carga (`await keyStore.warm()`) antes de `app.listen`, registra `requireBearer(keyStore)` en `app.post('/mcp', requireBearer(keyStore), async (req, res) => ...)`. Si la primera carga falla, log error y `process.exit(1)`.
  - **Verify:** integración local con KV emulado (variable de entorno `MCP_API_KEYS_LOCAL_JSON` con el JSON, modo dev) o KV real. `pnpm build && pnpm start` levanta server. `curl localhost:3001/health` → 200. `curl -X POST localhost:3001/mcp` → 401. `curl -X POST localhost:3001/mcp -H 'Authorization: Bearer <key>'` → 200.

- [x] **A1.7** Modo dev local sin KV.
  - **AC:** si `process.env.MCP_API_KEYS_LOCAL_JSON` está seteada, `KeyStore` la usa en lugar de hacer fetch a KV. Documentar en `mcp-server/README.md` la sección "Desarrollo local" cómo generar y setear esa env var con un script `pnpm dev:gen-key`.
  - **Verify:** `pnpm dev:gen-key` imprime: `MCP_API_KEYS_LOCAL_JSON='[{"clientId":"dev","keyId":"local","keyHash":"...","createdAt":"...","revokedAt":null}]'` y la plaintext correspondiente para usar en `Authorization: Bearer ...`.

> ⛳ **Slice A1 cierra** cuando todos los tests pasan localmente y el server corre con auth en modo dev.

---

## Slice A2 — Infra: KV secret + secretRef en `ca-mcp`

- [x] **A2.1** Generar valor inicial del secret `mcp-api-keys`.
  - **AC:** script `scripts/bootstrap-mcp-api-keys.sh` (o equivalente Node) genera dos pares `(plaintext, keyHash)` para `clientId: "web"` y `clientId: "dev"`, arma el JSON de keys y lo persiste en KV: `az keyvault secret set --vault-name <kv> --name mcp-api-keys --value '<json>'`. Imprime los **plaintexts** una sola vez (los hashes ya quedaron en KV; los plaintexts deben copiarse a A2.4 y a `MCP_API_KEY` del web en A3).
  - **Verify:** `az keyvault secret show --name mcp-api-keys --vault-name <kv> --query "value" -o tsv | jq 'length'` → `2`. Plaintext del cliente "web" se guarda como secret separado en A2.4.

- [x] **A2.2** Bicep — modificar `infra/main.bicep` para pasar el secret a `mcpApp`.
  - **AC:** module `mcpApp` recibe un nuevo parámetro:
    ```bicep
    secrets: [
      { name: 'mcp-api-keys', keyVaultUrl: '${keyVault.outputs.uri}secrets/mcp-api-keys' }
    ]
    secretEnvVars: [
      { name: 'MCP_API_KEYS_SECRET', secretRef: 'mcp-api-keys' }
    ]
    ```
  - **Verify:** `az bicep build infra/main.bicep` sin errores. `az deployment group create --mode Incremental --template-file infra/main.bicep ...` → `Succeeded`. `az containerapp show -n ca-mcp-fintech-${env} --query "properties.configuration.secrets[].name"` → `["mcp-api-keys"]`. `... --query "properties.template.containers[0].env"` muestra `MCP_API_KEYS_SECRET` con `secretRef: mcp-api-keys`.

- [x] **A2.3** Wirear `MCP_API_KEYS_SECRET` en código.
  - **AC:** `KeyStore` (de A1.3) lee env var `MCP_API_KEYS_SECRET` (JSON string ya inyectado por Container Apps desde KV) en producción, sin necesidad de llamar al SDK de KV. **Refresh** sigue siendo desde el SDK por si hay rotación sin redeploy. Decisión registrada en `SPEC.md`: env var es bootstrap rápido + cache inicial; refresh es vía SDK directo.
  - **Verify:** `pnpm build` y deploy. `az containerapp logs show -n ca-mcp-fintech-${env}` muestra `KeyStore loaded N keys (initial)` al boot.

- [x] **A2.4** Secret separado `mcp-api-key-web` (plaintext del cliente "web").
  - **AC:** `az keyvault secret set --name mcp-api-key-web --vault-name <kv> --value '<plaintext-de-A2.1>'`. Este secret existe en KV solo para que `ca-web` lo consuma vía secretRef. Tiene tag `purpose=mcp-bearer`.
  - **Verify:** `az keyvault secret show --name mcp-api-key-web --vault-name <kv> --query "tags" -o json` muestra `{"purpose":"mcp-bearer"}`.

- [x] **A2.5** Smoke test post-deploy del MCP con auth obligatoria.
  - **AC:** desde un job temporal en el CAE (`az containerapp exec` o equivalente):
    ```bash
    curl -fsS -o /dev/null -w "%{http_code}" -X POST http://ca-mcp-fintech-${env}/mcp -H "Content-Type: application/json" -d '{}'
    # 401
    curl -fsS -o /dev/null -w "%{http_code}" -X POST http://ca-mcp-fintech-${env}/mcp -H "Content-Type: application/json" -H "Authorization: Bearer <plaintext-web>" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
    # 200
    curl -fsS -o /dev/null -w "%{http_code}" http://ca-mcp-fintech-${env}/health
    # 200
    ```
  - **Verify:** los tres status codes son los esperados.

> ⛳ **Checkpoint CP-Auth-1** — el MCP rechaza requests sin auth válido. **Bloqueante de A3:** sin esto, el web podría empezar a enviar el header sin que el server valide.

---

## Slice A3 — Web client envía `Authorization`

- [ ] **A3.1** RBAC — sumar `Key Vault Secrets User` a `uai-web-${env}` con scope al secret específico.
  - **AC:** `infra/modules/web-identity.bicep` (o un módulo nuevo `web-kv-rbac.bicep`) asigna el rol `Key Vault Secrets User` a `uai-web-${env}` con `--scope` apuntando a `<kv-id>/secrets/mcp-api-key-web` (Azure RBAC for Key Vault soporta scope a nivel secret). Si el RBAC granular falla por limitación de Azure, fallback documentado: scope al vault completo con justificación en comentario Bicep.
  - **Verify:** `az role assignment list --assignee <web-uai-principalId> --scope "<kv-id>/secrets/mcp-api-key-web" --query "[].roleDefinitionName" -o tsv` retorna `Key Vault Secrets User`.

- [ ] **A3.2** Bicep — secretRef en `webApp`.
  - **AC:** `infra/main.bicep` para `module webApp` agrega:
    ```bicep
    secrets: [
      { name: 'mcp-api-key-web', keyVaultUrl: '${keyVault.outputs.uri}secrets/mcp-api-key-web' }
    ]
    secretEnvVars: [
      { name: 'MCP_API_KEY', secretRef: 'mcp-api-key-web' }
    ]
    ```
  - **Verify:** post-deploy, `az containerapp show -n ca-web-fintech-${env} --query "properties.template.containers[0].env[?name=='MCP_API_KEY']"` retorna entry con `secretRef`.

- [ ] **A3.3** Web — `app/page.tsx` envía Authorization si la env var existe.
  - **AC:** el fetch al `/health` (y futuros calls) incluye `Authorization: Bearer ${process.env.MCP_API_KEY}` cuando la env está seteada. Si no está (modo dev local sin auth configurada), no envía el header y loggea warning una vez al boot. La página sigue siendo Server Component con `force-dynamic` y mantiene el comportamiento de "200 con error" si el MCP responde 401/403 o cae.
  - **Verify:** test integración con `MCP_API_KEY` seteada vs no seteada — el primer caso envía header, el segundo no. En el segundo caso, log de warning visible con `pnpm dev`.

- [ ] **A3.4** Smoke test end-to-end.
  - **AC:** post-deploy de A3.2/A3.3, abrir `https://ca-web-fintech-${env}-...azurecontainerapps.io/`. La página renderiza el JSON del `/health` del MCP (no error). Query a Log Analytics confirma que un log `tool.call` (cuando lleguen las tools de plan-tools.md) o un log de health-probe atendido provino del clientId `web`.
  - **Verify:** verificación manual del navegador + `az monitor log-analytics query --workspace <log-fintech-${env}-id> --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'ca-mcp-fintech-${env}' | extend log = parse_json(Log_s) | where log.clientId == 'web' | take 10"`.

- [ ] **A3.5** Verificar fallback degradado.
  - **AC:** revoke temporal de la key del web (set `revokedAt` en el JSON del secret `mcp-api-keys`) → tras 60s de cache TTL el MCP rechaza con 403 → la web responde 200 con mensaje de error en pantalla (no 5xx). Restore de la key cierra el test.
  - **Verify:** observar HTTP status 200 con body de error en el navegador. Revertir cambios al cerrar.

> ⛳ **Checkpoint CP-Auth-2** — flujo end-to-end web→MCP autenticado con clientId visible en telemetría.

---

## Slice A4 — Telemetría + procedimiento de rotación

- [ ] **A4.1** `clientId` en payload del log `tool.call`.
  - **AC:** cuando llegue Slice 0/Slice 2 de [plan-tools.md](plan-tools.md), el handler de tools lee `req.auth.clientId` y lo agrega al payload del log JSON `tool.call`. Por ahora (sin tools reales todavía), agregar la convención al `SPEC.md` § 6.4 para que las tools la sigan desde su primera implementación.
  - **Verify:** SPEC actualizado. Test placeholder en `mcp-server/src/server/auth/__tests__/instrumentation.test.ts` que verifica que el middleware deja `req.auth` accesible para handlers downstream.

- [ ] **A4.2** Log `auth.failure` con campos consistentes.
  - **AC:** ya emitido en A1.5; este slice lo documenta en `SPEC.md` § 8 ("Always do") como obligación: "Cada fallo de auth emite log JSON `{ event: 'auth.failure', reason, inputHash, ip? }`. No incluye plaintext del header."
  - **Verify:** SPEC actualizado.

- [ ] **A4.3** `docs/KEY_ROTATION.md`.
  - **AC:** procedimiento manual paso a paso:
    1. Generar nueva key con `node scripts/generate-key.mjs`. Output: `{ plaintext, hash, keyId }`.
    2. Leer secret actual con `az keyvault secret show --name mcp-api-keys --vault-name <kv> --query value -o tsv > /tmp/keys.json`.
    3. Editar `/tmp/keys.json`: agregar nueva entry para el clientId. **No** marcar la vieja con `revokedAt` todavía.
    4. Push: `az keyvault secret set --vault-name <kv> --name mcp-api-keys --value "$(cat /tmp/keys.json)"`.
    5. Esperar 60s (TTL del cache en KeyStore) o `az containerapp revision restart` para refresh inmediato.
    6. Si el cliente es `web`: `az keyvault secret set --vault-name <kv> --name mcp-api-key-web --value <plaintext-nuevo>` y `az containerapp revision restart -n ca-web-fintech-${env}`.
    7. Verificar telemetría: el log `tool.call` con el `keyId` nuevo aparece en Log Analytics (o, en bootstrap, simplemente confirmar 200 con `curl -H "Authorization: Bearer <plaintext-nuevo>"`).
    8. Revocar la vieja: editar JSON, agregar `revokedAt: <iso>` a la entry vieja, push otra vez.
    9. Esperar 60s y confirmar que la vieja ya no autoriza.
  - **Verify:** ejecutar el proc en dev contra una key dummy. Documentar tiempos reales en el doc.

- [ ] **A4.4** Script `pnpm rotate-key <clientId>` (opcional).
  - **AC:** `mcp-server/scripts/rotate-key.mjs` automatiza A4.3 pasos 1-4. Imprime el plaintext nuevo y un comando sugerido para A4.3.6 (que se hace manual porque toca otro Container App). Soporta `--revoke <keyId>` para forzar revocación inmediata.
  - **Verify:** ejecutar `pnpm rotate-key dev` en dev. Confirmar que la nueva key autoriza en <60s y la vieja deja de autorizar después del `--revoke`.

> ⛳ **Slice A4 cierra** la auth como funcionalidad operable. Cualquier nuevo cliente (extensión, app SMS) sigue el mismo patrón: secret separado en KV con tag `purpose=mcp-bearer`, RBAC scoped, env var `MCP_API_KEY` en su Container App.

---

## Verificación end-to-end (todos los slices)

Ver [tasks/plan-auth.md § Verificación end-to-end](plan-auth.md#verificación-end-to-end-al-cierre).
