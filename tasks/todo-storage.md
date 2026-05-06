# TODO — Storage persistente Azure Files SMB

> Plan: [tasks/plan-storage.md](plan-storage.md) · SPEC: [SPEC.md](../SPEC.md)
> Convención: cada tarea tiene **AC** (acceptance criteria) y **Verify** (cómo probar). No marcar `[x]` sin pasar Verify.

---

## Slice S1 — Infraestructura: File Share + CAE storage + volumeMount

Trabajo en Bicep + script de bootstrap. Sin cambios de código de la app.

- [x] **S1.1** Agregar File Share `mcp-data` en storage Bicep.
  - **AC:** [infra/modules/storage.bicep](../infra/modules/storage.bicep) tiene un recurso hijo `Microsoft.Storage/storageAccounts/fileServices/shares` con `name: 'mcp-data'`, `properties.shareQuota: 100`, `properties.accessTier: 'TransactionOptimized'`, `properties.enabledProtocols: 'SMB'`. Outputs nuevos: `fileShareName`, `storageAccountName` (ya hay `storageAccountId` implícito, exportar explícito si falta). Los 3 blob containers (`cache-cmf`, `cache-rpsf`, `audit`) quedan intactos en este slice.
  - **Verify:** `az bicep build --file infra/main.bicep` sin errores. `az deployment group what-if -g <rg> -f infra/main.bicep -p @infra/main.dev.parameters.json` muestra `+ Microsoft.Storage/storageAccounts/fileServices/shares/mcp-data` y ningún `-` sobre los containers.

- [x] **S1.2** Script `seed-storage-key-secret.mjs` para sembrar la account key en Key Vault.
  - **AC:** [mcp-server/scripts/seed-storage-key-secret.mjs](../mcp-server/scripts/seed-storage-key-secret.mjs) (nuevo, `.mjs` para alinear con `bootstrap-mcp-api-keys.mjs`). Args: `--storage-account <st> --vault <kv>`. Lee key 1 vía `az storage account keys list`, compara con la versión actual del secret `storage-account-key` y solo escribe si difiere (sin churn de versiones). Permisos requeridos documentados en el header.
  - **Verify:** `node --check` pasa; ejecutar sin args sale con código 2 y mensaje de uso. End-to-end (post-deploy de S1.5): `node mcp-server/scripts/seed-storage-key-secret.mjs --storage-account <st> --vault <kv>` y `az keyvault secret show --vault-name <kv> --name storage-account-key --query 'attributes.enabled'` retorna `true`. Re-ejecutar no crea nueva versión.

- [x] **S1.3** Definir `Microsoft.App/managedEnvironments/storages` en CAE Bicep.
  - **AC:** [infra/modules/container-apps-env.bicep](../infra/modules/container-apps-env.bicep) recibe params opcionales `dataStorageAccountName`, `dataFileShareName`, `dataStorageAccountKey` (con `@secure()`). Cuando los tres están set, crea recurso hijo `Microsoft.App/managedEnvironments/storages@2024-03-01` con `name: 'mcp-data-storage'`, `properties.azureFile: { accountName, accountKey, shareName, accessMode: 'ReadWrite' }`. Output `dataStorageDefinitionName` (vacío si la definición no se crea). Defaults vacíos permiten que main.bicep siga compilando antes de S1.5.
  - **Verify:** `az bicep build --file infra/main.bicep` sin errores ni warnings. ARM compilado contiene `Microsoft.App/managedEnvironments/storages` con `condition` ligado a `variables('enableDataStorage')`.

- [x] **S1.4** Parametrizar `volumes` y `volumeMounts` en el módulo Container App.
  - **AC:** [infra/modules/container-app.bicep](../infra/modules/container-app.bicep) acepta dos parámetros opcionales: `volumes: array = []`, `volumeMounts: array = []`. Inyectados como `template.volumes` y `template.containers[0].volumeMounts` solo si tienen elementos (no romper el web app que los pasa vacíos). Sin cambios de tipos en el callsite del web app.
  - **Verify:** `az bicep build` ok. Deploy del web app sigue exitoso (regression). El módulo inyecta el array vacío correctamente (revisar el output del template intermedio con `--debug`).

- [x] **S1.5** Wirear todo en `main.bicep` y montar `/app/data` en MCP.
  - **AC:** [infra/main.bicep](../infra/main.bicep): vars `storageAccountName` y `dataFileShareName` centralizados (evita BCP307 con outputs de módulo). `existing` reference al storage account → `listKeys()` para inyectar la key en el CAE. `mcpApp` recibe `volumes: [{ name: 'data-volume', storageType: 'AzureFile', storageName: cae.outputs.dataStorageDefinitionName }]` + `volumeMounts: [{ volumeName: 'data-volume', mountPath: '/app/data' }]` + env var `DATA_DIR=/app/data`. La key del storage también queda copiada al KV vía script (S1.2) para uso de bootstrap scripts.
  - **Verify:** `az bicep build --file infra/main.bicep` exit 0. ARM compilado muestra `mcpApp.parameters.volumes[0].storageName=<reference cae.outputs.dataStorageDefinitionName>`, `volumeMounts[0].mountPath='/app/data'`, env var `DATA_DIR=/app/data` presente. Deploy end-to-end queda para post-merge en RG real.

- [x] **S1.6** Probar el mount con archivo de prueba.
  - **AC:** desde el container running, escribir y leer en `/app/data`.
  - **Verify (ejecutado 2026-05-06 en RG `oarocha-fintech`, revision `ca-mcp-fintech-dev--0000009`):** `az containerapp exec --command 'touch /app/data/_probe.txt'` exitoso; `ls -la /app/data` muestra el archivo con permisos `drwxrwxrwx`; `rm` exitoso. Mount bidireccional confirmado. Nota: `sh -c 'echo > ...'` con redirect requiere doble-quoting raro en `az containerapp exec` — usar comandos sin redirect (`touch`, `cat`) es lo más simple.

---

## Slice S2 — Bootstrap: subir contenido de `data/` al File Share

- [x] **S2.1** Script `upload-data-to-share.mjs`.
  - **AC:** [mcp-server/scripts/upload-data-to-share.mjs](../mcp-server/scripts/upload-data-to-share.mjs) (nuevo). Args: `--storage-account <st> --vault <kv> [--data-dir ./data] [--share mcp-data]`. Lee `storage-account-key` de KV. Ejecuta `az storage file upload-batch` para `*.csv` y `*.xlsx` → `snapshots/cmf/`, y `data/normativas/` → `normativas/` recursivo (preserva `sii/`). `az storage directory create` (idempotente, tolera "already exists") para `snapshots/rpsf/` y `audit/`. Cambio vs plan: directorios vacíos en lugar de `.keep` files (`upload` single file falla con `ParentNotFound` si el dir padre no existe; `directory create` es la primitiva correcta).
  - **Verify (ejecutado 2026-05-06 contra `stfintechdevic66pjdlbzw6`/`mcp-data`):** 8 archivos en `snapshots/cmf` (4 CSV + 4 XLSX), 12 en `normativas` raíz (6 .md + 6 .pdf), 8 en `normativas/sii` (4 .md + 4 .pdf), directorios `audit` y `snapshots/rpsf` creados. Re-ejecución limpia (idempotente).

- [x] **S2.2** Documentar la sincronización en README.
  - **AC:** [README.md](../README.md) sección "Datos y referencias locales" tiene un bloque "Sincronización al File Share" con: comando del script, qué se sube, cómo agregar nuevas normativas, advertencia de que el File Share es la fuente de verdad en runtime.
  - **Verify:** sección renderiza ok en GitHub preview; los comandos copiados se ejecutan sin modificación.

- [x] **S2.3** Verificar contenido desde dentro del container.
  - **AC:** estructura completa visible en `/app/data` desde el MCP server.
  - **Verify (ejecutado 2026-05-06 en revision `ca-mcp-fintech-dev--0000011`):** `find /app/data -type f` lista los 28 archivos esperados — 8 en `snapshots/cmf/` (CSV+XLSX), 12 en `normativas/` raíz (.md+.pdf), 8 en `normativas/sii/` (.md+.pdf). Layout consistente con la jerarquía objetivo del plan.

---

## Checkpoint A — Validación humana antes de eliminar blobs

- [x] **CA.1** Mount estable a través de restarts.
  - **Verify (2026-05-06, revision `ca-mcp-fintech-dev--0000016`):** post `az containerapp revision restart`, `ls /app/data/normativas/sii` lista los 8 archivos esperados (4 .md + 4 .pdf SII). Mount sobrevive al restart.

- [x] **CA.2** Performance de lectura aceptable.
  - **Verify (2026-05-06):** `time cat /app/data/snapshots/cmf/creditos_fraudulentos.csv > /dev/null` → `real 0m0.02s` (20ms, 25× bajo el SLA de 500ms).

- [x] **CA.3** Costo del File Share revisado.
  - **Verify (2026-05-06):** la suscripción es **Pharmkt Sponsorship** y no expone Cost analysis con cifras en el portal (suscripciones sponsorship omiten el desglose). Sustituto: configuración de mínimo costo verificada en Properties del storage account `stfintechdevic66pjdlbzw6` — `Standard_LRS` (no GRS/ZRS), `StorageV2`, `Hot` default tier, secure transfer + TLS 1.2 enabled. File Share `mcp-data` 100 GiB cuota con ~300 MB usados (cobra solo lo usado), tier `TransactionOptimized`. Sin features premium accidentales.

---

## Slice S3 — Módulo `src/lib/storage.ts` con helpers tipados

- [x] **S3.1** Implementar helpers de I/O contra `DATA_DIR`.
  - **AC:** [src/lib/storage.ts](../src/lib/storage.ts) (nuevo) exporta:
    - `getDataDir(): string` — lee `process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data')`.
    - `readDataFile(relativePath: string): Promise<Buffer>`.
    - `writeDataFile(relativePath: string, content: Buffer | string): Promise<void>` — crea directorios padre con `fs.mkdir({ recursive: true })`.
    - `listDataFiles(relativeDir: string): Promise<string[]>` — retorna paths relativos.
    - `appendAuditLine(event: Record<string, unknown>): Promise<void>` — resuelve a `audit/${YYYY-MM-DD}.jsonl` (UTC), append-only `JSON.stringify(event) + '\n'`.
    - Path traversal guard: cada operación valida `path.resolve(getDataDir(), rel).startsWith(getDataDir() + path.sep)`. Si falla, lanza `StoragePathError`.
    - Errores tipados: `StorageReadError`, `StorageWriteError`, `StoragePathError` (clases con `cause` opcional).
  - **Verify:** `pnpm tsc --noEmit` verde. Importable desde `src/index.ts` sin errores.

- [x] **S3.2** Tests de unidad para `storage.ts`.
  - **AC:** [src/lib/storage.test.ts](../src/lib/storage.test.ts) cubre: (a) `readDataFile` lee archivo existente; (b) `writeDataFile` crea archivo + directorios padre; (c) path traversal con `../etc/passwd` lanza `StoragePathError`; (d) path absoluto fuera de `DATA_DIR` lanza `StoragePathError`; (e) `appendAuditLine` agrega líneas sin sobrescribir; (f) `listDataFiles` retorna solo files (no dirs). Usa `tmpdir()` + `DATA_DIR` override por test.
  - **Verify:** `pnpm test src/lib/storage.test.ts` ≥ 6 tests passing. Cobertura del módulo ≥ 90% (medir con vitest coverage).

- [x] **S3.3** Loggear `dataDir` al boot.
  - **AC:** [src/index.ts](../src/index.ts) llama `getDataDir()` al iniciar y emite log JSON `{ event: "boot.dataDir", path: "<...>" }`. Sin PII (path de filesystem es seguro). No expone en `/health` (innecesario).
  - **Verify:** `pnpm build && pnpm start` con `DATA_DIR=/tmp/x` imprime el JSON con ese path en stdout.

- [x] **S3.4** Quality gates verdes (ejecutado 2026-05-06: `pnpm typecheck` + `pnpm build` + `pnpm test` → 223/223 tests pasan, 12 nuevos para storage).
  - **AC:** `pnpm tsc --noEmit` + `pnpm lint` (o `biome check`) + `pnpm test` todos verdes.
  - **Verify:** comandos retornan exit 0.

---

## Slice S4 — Suavizar persistencia blob (opción B: dormant, no borrar)

> **Cambio de alcance vs plan original:** la otra sesión de trabajo decidió mantener `createBlobStore` en `cache.ts` "ready to be wired" para futuros tools (commit `b87c2d9`). En lugar de borrar los containers blob, los marcamos como dormant: aprovisionados pero sin role assignment ni uso runtime. Documentación canónica vive en ADR-001 (S5.1).

- [x] **S4.1** ~~Borrar los 3 blob containers de Bicep.~~ → **NO se ejecuta.** Containers `cache-cmf`/`cache-rpsf`/`audit` permanecen en `infra/modules/storage.bicep` con comentario explícito de "DORMANT — la persistencia activa está en File Share `mcp-data`". Razón: opcionalidad para futuros tools (CMF, RPSF) sin costo significativo (containers vacíos, blob retention 7d).

- [x] **S4.2** Quitar role assignment obsoleto en MCP identity.
  - **AC:** [infra/modules/mcp-identity.bicep](../infra/modules/mcp-identity.bicep) ya no asigna `Storage Blob Data Contributor` ni recibe el param `storageAccountName`. Roles activos: `AcrPull` + `Key Vault Secrets User`. Comentario en cabecera apunta al ADR-001 y a las condiciones para reagregar el role en el futuro. `infra/main.bicep` ya no pasa `storageAccountName` al callsite del módulo.
  - **Verify:** `az bicep build --file infra/main.bicep` exit 0. ARM compilado del módulo `mcpIdentity` lista solo 2 `Microsoft.Authorization/roleAssignments` (AcrPull + KV Secrets User) — el Storage Blob Data Contributor desapareció. Post-deploy: `az role assignment list --assignee <uai-mcp-dev-principalId> --all --query "[].roleDefinitionName"` no incluye el role.

- [x] **S4.3** Actualizar SPEC §2 y §3.6 / §3.7.
  - **AC:** [SPEC.md](../SPEC.md): tabla de "Cache externo" reemplazada por dos filas — "Persistencia activa" (File Share + `DATA_DIR`) y "Cache opcional (dormant)" (blob containers aprovisionados pero sin role). Tabla de RBAC §3.6 marca "_(sin role asignado)_" en la fila Storage Account. §3.7 sobre `data/` explica que el contenido se sincroniza al File Share `mcp-data` con `upload-data-to-share.mjs` y se lee en runtime desde `/app/data`. Refresh operacional ya no menciona blob `cache-cmf` como destino. Docs de `cache.ts` y `refresh-cmf.ts` apuntan al File Share. Tests con Azurite quedan registrados como "reabrir si se reactiva blob backend".
  - **Verify:** `grep -n "Storage Blob Data Contributor\|persiste a Storage Blob\|cache-cmf\|cache-rpsf" SPEC.md` solo retorna las referencias contextuales (Cache opcional dormant, ADR-001, alternativas históricas), no como mecanismo activo.

- [x] **S4.4** App verde end-to-end (post-deploy).
  - **AC:** flujo completo (deploy → seed key → upload data → request a `/mcp`) pasa con el role assignment removido.
  - **Verify (2026-05-06, revision `ca-mcp-fintech-dev--0000016`):** redeploy `storage-volume-s1` aplicado. El role `Storage Blob Data Contributor` quedó huérfano (Bicep ARM no borra role assignments al sacarlos del template); se eliminó manualmente con `az role assignment delete --ids`. UAI `uai-mcp-dev` ahora lista solo `Key Vault Secrets User` + `AcrPull`. File Share sigue montando porque el mount usa account key vía CAE storage definition. Reads en `/app/data/normativas/sii` y `time cat` de Checkpoint A confirman que no hubo regresión.

---

## Slice S5 — Documentación y ADR

- [x] **S5.1** Escribir ADR-001.
  - **AC:** [docs/adr/ADR-001-azure-files-volume-vs-blob.md](../docs/adr/ADR-001-azure-files-volume-vs-blob.md) creado. Secciones: Status (Accepted), Context (decisión previa + qué cambió, incluyendo la señal del revert `b87c2d9`), Decision (File Share activo + blob dormant), Consequences (positivas/negativas/neutrales), Alternatives (Blob-only, NFS, EmptyDir, eliminación total), Implementación (5 slices con commits), Referencias.
  - **Verify:** archivo renderiza con encabezado y links válidos. ADR-001 referenciado desde SPEC.md §2/§3.6/§3.7 y desde tasks/plan.md.

- [x] **S5.2** Actualizar README.
  - **AC:** [README.md](../README.md) sección "Datos y referencias locales" cierra con un blockquote que linkea al ADR-001 y resume la decisión convergente (File Share activo + blob dormant). Sección de bootstrap (S2.2) ya documenta estructura, comandos y cómo agregar normativas.
  - **Verify:** link relativo `docs/adr/ADR-001-azure-files-volume-vs-blob.md` resuelve correcto desde la raíz del repo.

- [x] **S5.3** Actualizar `tasks/plan.md` (top-level).
  - **AC:** [tasks/plan.md](plan.md) línea 15 reemplazada por dos líneas: una declarando el File Share como persistencia activa (con link al ADR-001) y otra explicando que los blob containers quedan dormant para reactivación futura.
  - **Verify:** `grep -n "Storage Blob (3 containers" tasks/plan.md` no retorna nada (frase original eliminada).
