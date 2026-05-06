# TODO — Storage persistente Azure Files SMB

> Plan: [tasks/plan-storage.md](plan-storage.md) · SPEC: [SPEC.md](../SPEC.md)
> Convención: cada tarea tiene **AC** (acceptance criteria) y **Verify** (cómo probar). No marcar `[x]` sin pasar Verify.

---

## Slice S1 — Infraestructura: File Share + CAE storage + volumeMount

Trabajo en Bicep + script de bootstrap. Sin cambios de código de la app.

- [x] **S1.1** Agregar File Share `mcp-data` en storage Bicep.
  - **AC:** [infra/modules/storage.bicep](../infra/modules/storage.bicep) tiene un recurso hijo `Microsoft.Storage/storageAccounts/fileServices/shares` con `name: 'mcp-data'`, `properties.shareQuota: 100`, `properties.accessTier: 'TransactionOptimized'`, `properties.enabledProtocols: 'SMB'`. Outputs nuevos: `fileShareName`, `storageAccountName` (ya hay `storageAccountId` implícito, exportar explícito si falta). Los 3 blob containers (`cache-cmf`, `cache-rpsf`, `audit`) quedan intactos en este slice.
  - **Verify:** `az bicep build --file infra/main.bicep` sin errores. `az deployment group what-if -g <rg> -f infra/main.bicep -p @infra/main.dev.parameters.json` muestra `+ Microsoft.Storage/storageAccounts/fileServices/shares/mcp-data` y ningún `-` sobre los containers.

- [ ] **S1.2** Script `seed-storage-key-secret.sh` para sembrar la account key en Key Vault.
  - **AC:** [scripts/seed-storage-key-secret.sh](../scripts/seed-storage-key-secret.sh) (nuevo). Recibe `<env>` (ej: `dev`). Resuelve `<storageAccount>` y `<keyVault>` desde outputs del deployment o desde naming convention. Ejecuta `az storage account keys list --account-name <st> --query '[0].value' -o tsv` y `az keyvault secret set --vault-name <kv> --name storage-account-key --value <key>`. Idempotente (no falla si el secret ya existe). Permisos: comentario sobre rotación.
  - **Verify:** ejecutar `./scripts/seed-storage-key-secret.sh dev` y `az keyvault secret show --vault-name <kv> --name storage-account-key --query 'attributes.enabled'` retorna `true`. Ejecutar dos veces seguidas no falla.

- [ ] **S1.3** Definir `Microsoft.App/managedEnvironments/storages` en CAE Bicep.
  - **AC:** [infra/modules/container-apps-env.bicep](../infra/modules/container-apps-env.bicep) recibe parámetros `storageAccountName: string`, `fileShareName: string`, `storageAccountKey: string` (con `@secure()`). Agrega recurso hijo del CAE: `Microsoft.App/managedEnvironments/storages@2024-03-01` con `name: 'mcp-data-storage'`, `properties.azureFile: { accountName, accountKey, shareName, accessMode: 'ReadWrite' }`. Output `storageDefinitionName: string`.
  - **Verify:** `az bicep build` sin warnings sobre `@secure()`. `az deployment group what-if` muestra `+ …/managedEnvironments/<cae>/storages/mcp-data-storage`.

- [ ] **S1.4** Parametrizar `volumes` y `volumeMounts` en el módulo Container App.
  - **AC:** [infra/modules/container-app.bicep](../infra/modules/container-app.bicep) acepta dos parámetros opcionales: `volumes: array = []`, `volumeMounts: array = []`. Inyectados como `template.volumes` y `template.containers[0].volumeMounts` solo si tienen elementos (no romper el web app que los pasa vacíos). Sin cambios de tipos en el callsite del web app.
  - **Verify:** `az bicep build` ok. Deploy del web app sigue exitoso (regression). El módulo inyecta el array vacío correctamente (revisar el output del template intermedio con `--debug`).

- [ ] **S1.5** Wirear todo en `main.bicep` y montar `/app/data` en MCP.
  - **AC:** [infra/main.bicep](../infra/main.bicep): orden de módulos `storage` → `keyVault` → `cae` (con `storageAccountName`, `fileShareName`, `storageAccountKey: <referencia a KV via getSecret() o param>`) → `mcpApp`. `mcpApp` recibe `volumes: [{ name: 'data-volume', storageType: 'AzureFile', storageName: cae.outputs.storageDefinitionName }]` y `volumeMounts: [{ volumeName: 'data-volume', mountPath: '/app/data' }]`. Agregar env var `DATA_DIR=/app/data` al `envVars` de mcpApp.
  - **Verify:** deploy completo `az deployment group create -g <rg> -f infra/main.bicep -p @infra/main.dev.parameters.json` ok. `az containerapp show -n ca-mcp-fintech-dev -g <rg> --query 'properties.template.volumes'` muestra el volumen y `--query 'properties.template.containers[0].volumeMounts'` muestra el mount.

- [ ] **S1.6** Probar el mount con archivo de prueba.
  - **AC:** desde el container running, escribir y leer en `/app/data`.
  - **Verify:** `az containerapp exec -n ca-mcp-fintech-dev -g <rg> --command "sh -c 'echo hello > /app/data/_probe.txt && cat /app/data/_probe.txt && rm /app/data/_probe.txt'"` imprime `hello`. `curl https://<mcp-internal>/health` sigue 200.

---

## Slice S2 — Bootstrap: subir contenido de `data/` al File Share

- [ ] **S2.1** Script `upload-data-to-share.sh`.
  - **AC:** [scripts/upload-data-to-share.sh](../scripts/upload-data-to-share.sh) (nuevo). Recibe `<env>`. Lee `storage-account-key` de KV. Ejecuta `az storage file upload-batch` mapeando: `data/*.csv` y `data/*.xlsx` → `snapshots/cmf/`; `data/normativas/` → `normativas/` recursivo (preserva subcarpeta `sii/`). Crea `snapshots/rpsf/.keep` y `audit/.keep` con `az storage file upload`. Idempotente (re-ejecutable sin errores).
  - **Verify:** `./scripts/upload-data-to-share.sh dev`. `az storage file list --account-name <st> --share-name mcp-data --path normativas --output table` muestra 6 `.md` + 6 `.pdf` + carpeta `sii`. `… --path snapshots/cmf` muestra 4 CSV + 4 XLSX. Re-ejecutar el script sale con código 0.

- [ ] **S2.2** Documentar la sincronización en README.
  - **AC:** [README.md](../README.md) sección "Datos y referencias locales" tiene un bloque "Sincronización al File Share" con: comando del script, qué se sube, cómo agregar nuevas normativas, advertencia de que el File Share es la fuente de verdad en runtime.
  - **Verify:** sección renderiza ok en GitHub preview; los comandos copiados se ejecutan sin modificación.

- [ ] **S2.3** Verificar contenido desde dentro del container.
  - **AC:** estructura completa visible en `/app/data` desde el MCP server.
  - **Verify:** `az containerapp exec -n ca-mcp-fintech-dev -g <rg> --command "sh -c 'find /app/data -type f | sort'"` lista ≥ 24 archivos coincidiendo con la estructura objetivo (8 snapshots + 12 normativas raíz + 8 sii + 2 .keep).

---

## Checkpoint A — Validación humana antes de eliminar blobs

- [ ] **CA.1** Mount estable a través de restarts.
  - **Verify:** `az containerapp revision restart -n ca-mcp-fintech-dev -g <rg>`; tras restart `ls /app/data/normativas` sigue mostrando los archivos.

- [ ] **CA.2** Performance de lectura aceptable.
  - **Verify:** `az containerapp exec … --command "sh -c 'time cat /app/data/snapshots/cmf/creditos_fraudulentos.csv > /dev/null'"` reporta < 500ms.

- [ ] **CA.3** Costo del File Share revisado en portal.
  - **Verify:** capture de cost analysis confirmando que TransactionOptimized + 100 GiB queda dentro del budget esperado.

---

## Slice S3 — Módulo `src/lib/storage.ts` con helpers tipados

- [ ] **S3.1** Implementar helpers de I/O contra `DATA_DIR`.
  - **AC:** [src/lib/storage.ts](../src/lib/storage.ts) (nuevo) exporta:
    - `getDataDir(): string` — lee `process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data')`.
    - `readDataFile(relativePath: string): Promise<Buffer>`.
    - `writeDataFile(relativePath: string, content: Buffer | string): Promise<void>` — crea directorios padre con `fs.mkdir({ recursive: true })`.
    - `listDataFiles(relativeDir: string): Promise<string[]>` — retorna paths relativos.
    - `appendAuditLine(event: Record<string, unknown>): Promise<void>` — resuelve a `audit/${YYYY-MM-DD}.jsonl` (UTC), append-only `JSON.stringify(event) + '\n'`.
    - Path traversal guard: cada operación valida `path.resolve(getDataDir(), rel).startsWith(getDataDir() + path.sep)`. Si falla, lanza `StoragePathError`.
    - Errores tipados: `StorageReadError`, `StorageWriteError`, `StoragePathError` (clases con `cause` opcional).
  - **Verify:** `pnpm tsc --noEmit` verde. Importable desde `src/index.ts` sin errores.

- [ ] **S3.2** Tests de unidad para `storage.ts`.
  - **AC:** [src/lib/storage.test.ts](../src/lib/storage.test.ts) cubre: (a) `readDataFile` lee archivo existente; (b) `writeDataFile` crea archivo + directorios padre; (c) path traversal con `../etc/passwd` lanza `StoragePathError`; (d) path absoluto fuera de `DATA_DIR` lanza `StoragePathError`; (e) `appendAuditLine` agrega líneas sin sobrescribir; (f) `listDataFiles` retorna solo files (no dirs). Usa `tmpdir()` + `DATA_DIR` override por test.
  - **Verify:** `pnpm test src/lib/storage.test.ts` ≥ 6 tests passing. Cobertura del módulo ≥ 90% (medir con vitest coverage).

- [ ] **S3.3** Loggear `dataDir` al boot.
  - **AC:** [src/index.ts](../src/index.ts) llama `getDataDir()` al iniciar y emite log JSON `{ event: "boot.dataDir", path: "<...>" }`. Sin PII (path de filesystem es seguro). No expone en `/health` (innecesario).
  - **Verify:** `pnpm build && pnpm start` con `DATA_DIR=/tmp/x` imprime el JSON con ese path en stdout.

- [ ] **S3.4** Quality gates verdes.
  - **AC:** `pnpm tsc --noEmit` + `pnpm lint` (o `biome check`) + `pnpm test` todos verdes.
  - **Verify:** comandos retornan exit 0.

---

## Slice S4 — Eliminar blob containers obsoletos

- [ ] **S4.1** Borrar los 3 blob containers de Bicep.
  - **AC:** [infra/modules/storage.bicep](../infra/modules/storage.bicep) ya no contiene los recursos `cache-cmf`, `cache-rpsf`, `audit`. Si la policy de retención de blobs solo aplicaba a estos, borrarla también.
  - **Verify:** `az deployment group what-if` muestra `- Microsoft.Storage/storageAccounts/blobServices/containers/{cache-cmf,cache-rpsf,audit}`. Tras deploy: `az storage container list --account-name <st> --auth-mode login --query "[].name"` no incluye ninguno.

- [ ] **S4.2** Quitar role assignment obsoleto en MCP identity.
  - **AC:** [infra/modules/mcp-identity.bicep](../infra/modules/mcp-identity.bicep) no asigna `Storage Blob Data Contributor`. **No** agregar `Storage File Data SMB Share Contributor` (mount usa account key, no MI). Mantener `AcrPull` y `Key Vault Secrets User`.
  - **Verify:** `az role assignment list --assignee <uai-mcp-dev-principalId> --all --query "[].roleDefinitionName"` no incluye `Storage Blob Data Contributor`.

- [ ] **S4.3** Actualizar SPEC §2 y §3.7.
  - **AC:** [SPEC.md](../SPEC.md): tabla de "Cache externo" reemplaza la fila de `@azure/storage-blob` por File Share + `DATA_DIR`. §3.7 explica la decisión actual (filesystem semántico, key en KV) y archiva la decisión previa con marca histórica.
  - **Verify:** `grep -n "cache-cmf\|cache-rpsf\|cache-blob\|@azure/storage-blob" SPEC.md` solo retorna referencias en contexto histórico, no como mecanismo activo.

- [ ] **S4.4** App verde end-to-end.
  - **AC:** flujo completo (deploy → seed key → upload data → request a `/mcp`) pasa.
  - **Verify:** repetir Verify de S1.6 + S2.3 + (cuando exista una tool MCP que apenda audit) S3.x.

---

## Slice S5 — Documentación y ADR

- [ ] **S5.1** Escribir ADR-001.
  - **AC:** [docs/adr/ADR-001-azure-files-volume-vs-blob.md](../docs/adr/ADR-001-azure-files-volume-vs-blob.md) (nuevo) con secciones: Status (Accepted), Context (decisión previa SPEC §3.7 + por qué cambia), Decision (Azure Files SMB montado en `/app/data`, key en KV), Consequences (positivas: una fuente de verdad, semántica fs; negativas: account key como secret, dependencia de SMB en CAE), Alternatives considered (Blob containers, NFS, EmptyDir).
  - **Verify:** ADR aprobado por el dueño técnico (firma o PR review).

- [ ] **S5.2** Actualizar README.
  - **AC:** [README.md](../README.md) sección "Datos y referencias locales" describe: estructura del File Share, comando de bootstrap, dónde queda montado en runtime, cómo agregar normativas/snapshots nuevos, link a ADR-001.
  - **Verify:** sección renderiza ok en GitHub.

- [ ] **S5.3** Actualizar `tasks/plan.md` (top-level).
  - **AC:** [tasks/plan.md](plan.md) líneas ~14-15: línea "Cache: Storage Blob (3 containers…)" → "Storage: Azure Files SMB volume `/app/data` (1 share `mcp-data`)". Slice 3 del plan top-level se actualiza si menciona los containers.
  - **Verify:** `grep -n "cache-cmf\|cache-rpsf" tasks/plan.md` no retorna nada.
