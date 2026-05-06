# Plan — Storage persistente como volumen Azure Files SMB

## Contexto

Hoy `ca-mcp-<project>-<env>` no monta volúmenes. La persistencia planificada en [SPEC.md](../SPEC.md) §3.7 y §2 usa Blob Storage con tres containers (`cache-cmf`, `cache-rpsf`, `audit`) accedidos vía `@azure/storage-blob` + managed identity. La carpeta [data/](../data/) del repo solo sirve como referencia local (snapshots CMF + normativas PDF/MD), está en `.gitignore` y no se lee en runtime.

Este plan reemplaza esa decisión: **File Share SMB montado en `/app/data`** que dé al servicio semántica de filesystem y permita una jerarquía organizada que espeje el contenido actual de `data/`. Beneficios: una sola fuente de verdad, lectura directa de PDFs/MD/CSV sin SDK, audit append-only por archivos JSONL fechados, fixtures congelados accesibles sin duplicación. Tradeoff aceptado: Container Apps requiere account key (no MI) para el mount SMB; la key vive en Key Vault.

**Alcance:** solo infra del File Share, mount, bootstrap del seed inicial, helpers de I/O y limpieza de los blob containers obsoletos. No incluye implementación de jobs `refresh-cmf` / `refresh-rpsf` (siguen en [plan-tools.md](plan-tools.md)).

---

## Dependency graph

```
[Slice S1: File Share + CAE storage + volumeMount]
    │ volumen vacío montado en /app/data, app verde
    ▼
[Slice S2: Bootstrap upload de data/ → File Share]
    │ snapshots/cmf/, normativas/, audit/ poblados
    ▼
[Checkpoint A: validación humana de mount + costo]
    ▼
[Slice S3: src/lib/storage.ts + tests]
    │ API tipada con path traversal guard
    ▼
[Slice S4: eliminar blob containers obsoletos]
    │ storage.bicep limpio, role assignments alineados
    ▼
[Slice S5: ADR + doc updates]
```

Cada slice deja la app verde (build, tsc, tests). Los blobs se eliminan **después** de validar el mount.

---

## Estructura objetivo del File Share

```
mcp-data/                       (File Share, 100 GiB quota, TransactionOptimized)
├── snapshots/
│   ├── cmf/                    ← reemplaza container `cache-cmf`
│   │   ├── apps_creditos_no_reguladas.{csv,xlsx}
│   │   ├── creditos_fraudulentos.{csv,xlsx}
│   │   ├── otras_entidades_no_reguladas.{csv,xlsx}
│   │   └── plataformas_inversion_no_reguladas.{csv,xlsx}
│   └── rpsf/                   ← reemplaza `cache-rpsf` (vacío al inicio)
├── normativas/
│   ├── cir_2345_2024.{md,pdf}
│   ├── manual_sif_tablas_codificaciones.{md,pdf}
│   ├── ncg_502_2024.{md,pdf}
│   ├── ncg_503_2024.{md,pdf}
│   ├── ncg_504_2024.{md,pdf}
│   ├── ncg_514_2024.{md,pdf}
│   └── sii/
│       ├── circular_042_2020_economia_digital_iva.{md,pdf}
│       ├── reso_ex_036_2021_criptoactivos_regimen_general.{md,pdf}
│       ├── reso_ex_113_2025_dj1963_cripto_no_residentes.{md,pdf}
│       └── reso_ex_114_2025_dj1964_cripto_residentes.{md,pdf}
└── audit/                      ← reemplaza container `audit`
    └── YYYY-MM-DD.jsonl
```

`APIS.md` queda solo en repo (doc para humanos, no para runtime).

---

## Slice S1 — File Share + CAE storage + volumeMount

**Objetivo:** volumen montado en `/app/data` con archivo de prueba, sin tocar código de la app.

**Archivos:**
- [infra/modules/storage.bicep](../infra/modules/storage.bicep): agregar `Microsoft.Storage/storageAccounts/fileServices/shares` con nombre `mcp-data`, `shareQuota: 100`, `accessTier: TransactionOptimized`. Outputs: `fileShareName`, `storageAccountName`, `storageAccountId`. Mantener (por ahora) los 3 blob containers — se eliminan en S4.
- [infra/modules/container-apps-env.bicep](../infra/modules/container-apps-env.bicep): agregar recurso hijo `Microsoft.App/managedEnvironments/storages@2024-03-01` con nombre `mcp-data-storage`, `properties.azureFile.{accountName, accountKey, shareName: mcp-data, accessMode: ReadWrite}`. Recibir storage name + key como parámetros.
- [infra/modules/container-app.bicep](../infra/modules/container-app.bicep): agregar parámetros opcionales `volumes` y `volumeMounts` y inyectarlos en `template.volumes` y `template.containers[0].volumeMounts`. Sin breaking change para el web app.
- [infra/main.bicep](../infra/main.bicep): orden — `storage` → `keyVault` → `cae` (con storage name + key ref) → `mcpApp` (con `volumes` + `volumeMounts: [{ volumeName: 'data-volume', mountPath: '/app/data' }]`). Pasar `DATA_DIR=/app/data` como env var.

**Bootstrap one-time:**
- [scripts/seed-storage-key-secret.sh](../scripts/seed-storage-key-secret.sh) (nuevo): obtiene la key 1 vía `az storage account keys list` y la sube al KV como `storage-account-key`. Idempotente.

**Acceptance:** `az containerapp show … --query 'properties.template.volumes'` devuelve el volumen; `ls -la /app/data` lista directorio vacío; `GET /health` responde 200.

---

## Slice S2 — Bootstrap upload de `data/` → File Share

**Objetivo:** popular el File Share con la jerarquía objetivo desde el repo local.

**Archivos:**
- [scripts/upload-data-to-share.sh](../scripts/upload-data-to-share.sh) (nuevo): `az storage file upload-batch` con account key leído via `az keyvault secret show`. Mapea CSV/XLSX → `snapshots/cmf/`, `data/normativas/` → `normativas/` recursivo, crea `.keep` en `snapshots/rpsf/` y `audit/`. Idempotente.
- [README.md](../README.md) sección "Datos y referencias locales": agregar bloque "Sincronización al File Share".

**Acceptance:** `az storage file list --share-name mcp-data --path normativas` muestra 6 `.md` + 6 `.pdf` + subcarpeta `sii/`; `…--path snapshots/cmf` muestra 4 CSV + 4 XLSX; re-ejecutar no duplica.

---

## Checkpoint A — Validación humana

Antes de S3:
- Mount estable a través de `az containerapp revision restart`.
- `time cat /app/data/snapshots/cmf/creditos_fraudulentos.csv > /dev/null` < 500ms.
- Costos del File Share TransactionOptimized revisados en portal.

---

## Slice S3 — `src/lib/storage.ts` con helpers tipados

**Objetivo:** API único para leer/escribir `data/` con validación contra path traversal.

**Archivos:**
- [src/lib/storage.ts](../src/lib/storage.ts) (nuevo): `getDataDir()`, `readDataFile`, `writeDataFile`, `listDataFiles`, `appendAuditLine`. Path traversal guard (`path.resolve(dir, rel).startsWith(dir)`). Errores tipados `StorageReadError`, `StorageWriteError`, `StoragePathError`.
- [src/lib/storage.test.ts](../src/lib/storage.test.ts) (nuevo): casos para path traversal, lectura, escritura crea padres, append idempotente.
- [src/index.ts](../src/index.ts): leer `DATA_DIR` al boot y loggear sin PII.

**Acceptance:** `pnpm tsc --noEmit` verde; `pnpm test src/lib/storage.test.ts` ≥ 6 tests; `pnpm lint` sin warnings.

---

## Slice S4 — Eliminar blob containers obsoletos

**Objetivo:** quitar deuda una vez validado el volumen.

**Archivos:**
- [infra/modules/storage.bicep](../infra/modules/storage.bicep): borrar los 3 `Microsoft.Storage/storageAccounts/blobServices/containers` (`cache-cmf`, `cache-rpsf`, `audit`) y la policy de retención si solo aplicaba a estos.
- [infra/modules/mcp-identity.bicep](../infra/modules/mcp-identity.bicep): quitar role `Storage Blob Data Contributor`. **No** agregar `Storage File Data SMB Share Contributor` (mount usa key, no MI).
- [SPEC.md](../SPEC.md) §2 y §3.7: actualizar tabla y decisión.

**Acceptance:** `az storage container list` no devuelve los 3 containers; `az role assignment list --assignee <uai>` no incluye el role; app verde end-to-end.

---

## Slice S5 — ADR + doc updates

**Archivos:**
- [docs/adr/ADR-001-azure-files-volume-vs-blob.md](../docs/adr/ADR-001-azure-files-volume-vs-blob.md) (nuevo): contexto, decisión, consecuencias, alternativas descartadas.
- [README.md](../README.md): sección "Datos y referencias locales" — `data/` se sube al File Share `mcp-data`, montado en `/app/data`; comando de bootstrap; cómo agregar normativas.
- [tasks/plan.md](plan.md) líneas 14-15: actualizar línea "Cache: Storage Blob (3 containers…)" → "Storage: Azure Files SMB volume `/app/data`".

**Acceptance:** ADR aprobado; README renderiza ok; SPEC ya no menciona los 3 blob containers como mecanismo activo.

---

## Critical files reference

| Path | Razón |
|------|-------|
| [infra/main.bicep](../infra/main.bicep) | Orquestador — wirea storage → CAE → app |
| [infra/modules/storage.bicep](../infra/modules/storage.bicep) | File Share + cleanup de blobs en S4 |
| [infra/modules/container-apps-env.bicep](../infra/modules/container-apps-env.bicep) | `storages` ref del CAE |
| [infra/modules/container-app.bicep](../infra/modules/container-app.bicep) | `volumes` + `volumeMounts` |
| [infra/modules/mcp-identity.bicep](../infra/modules/mcp-identity.bicep) | Quitar role obsoleto en S4 |
| [SPEC.md](../SPEC.md) | §2 y §3.7 cambian de blob → file share |
| [src/lib/storage.ts](../src/lib/storage.ts) | API única de I/O contra `DATA_DIR` |

## Reuso

- `DefaultAzureCredential` de [src/server/auth/key-store.ts](../src/server/auth/key-store.ts) ya cubre el patrón Key Vault. **No** se reutiliza para el mount; **sí** opcionalmente para leer `storage-account-key` desde TS si el bootstrap migra a TS.
- Errores tipados siguen el patrón `PhishTankError`, `CMFFetchError` (CLAUDE.md "Errores tipados").

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Account key en CAE storage def es secret al portador | KV + rotación documentada + audit log |
| Performance SMB para PDFs ~2MB | TransactionOptimized + caché en memoria al boot si hace falta |
| Cambio vs SPEC vigente | ADR-001 + actualización SPEC §3.7 |
| Audit JSONL crece sin límite | Job mensual de archive (futuro, fuera de scope) |

## Verification end-to-end

```bash
# 1. Deploy
az deployment group create -g <rg> -f infra/main.bicep -p @infra/main.dev.parameters.json

# 2. Seed key + upload data
./scripts/seed-storage-key-secret.sh dev
./scripts/upload-data-to-share.sh dev

# 3. Verify mount + content
az containerapp exec -n ca-mcp-fintech-dev -g <rg> --command "sh -c 'ls -R /app/data | head -50 && cat /app/data/normativas/ncg_502_2024.md | head -5'"

# 4. Verify code reads it
curl -H "Authorization: Bearer <key>" https://<mcp-internal>/health

# 5. Verify writes
az containerapp exec -n ca-mcp-fintech-dev -g <rg> --command "ls -la /app/data/audit/"
```
