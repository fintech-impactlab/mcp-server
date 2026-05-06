# ADR-001: Azure Files SMB volume como persistencia activa, blob containers dormant

- **Status:** Accepted
- **Fecha:** 2026-05-06
- **Autores:** Oscar Arocha (con Claude Opus 4.7)
- **Supersede:** SPEC.md §3.7 versión previa que designaba Blob Storage como mecanismo activo.

## Contexto

El servicio MCP corre en Azure Container Apps (consumption) y necesita persistir tres clases de datos:

1. **Snapshots versionados de fuentes externas** — listados CMF Alertas Ciudadanas (CSV/XLSX), futuro registro RPSF, normativas (PDF + texto extraído `.md`).
2. **Audit logs** append-only (decisiones de scoring, llamadas a tools, eventos de auth).
3. **Cache opcional** entre réplicas o entre runs de jobs programados (`refresh-cmf`, `refresh-rpsf`).

La iteración inicial del SPEC (§3.7) decidió **Blob Storage** con tres containers (`cache-cmf`, `cache-rpsf`, `audit`) accedidos vía `@azure/storage-blob` + managed identity. La carpeta local `data/` se mantenía solo como referencia de equipo; nunca se leía en runtime.

Tras implementar el primer slice de tools (`get_market_reference_rates`) y planear el bootstrap del cache CMF, surgieron dos fricciones concretas:

- **Duplicación de código de seed.** Subir CSVs locales al blob al primer deploy implica un script paralelo a `refresh-cmf`, con su propia ruta de auth y serialización.
- **Dependencia SDK por cada lectura simple.** Leer un PDF o un CSV ya normalizado requiere instanciar `ContainerClient` + descargar el blob, frente a la simplicidad de `fs.readFile`. Para la mayoría de los tools la "cache" es realmente "snapshot estable que rota cada N días", no "kv compartido entre réplicas que cambia frecuente".

Adicionalmente, el revert `b87c2d9` de la sesión paralela documentó que **el cache distribuido entre réplicas no aporta valor para los tools actuales** (TTL 24h sobre datos pequeños = 1 fetch/réplica/día). El backend in-memory ya es suficiente, y para datos voluminosos (snapshots CMF, normativas) la semántica de filesystem es más natural.

## Decisión

**Persistencia activa: Azure Files SMB montado en `/app/data` (env var `DATA_DIR`)**, con la siguiente jerarquía:

```
/app/data/
├── snapshots/cmf/        ← CSVs/XLSX de CMF Alertas (sync vía upload-data-to-share.mjs)
├── snapshots/rpsf/       ← futuro RPSF (jobs lo poblan)
├── normativas/           ← PDFs + .md (NCG, circulares, manuales SII/CMF)
│   └── sii/
└── audit/                ← <YYYY-MM-DD>.jsonl append-only por runtime
```

- File Share: `mcp-data`, 100 GiB quota, tier `TransactionOptimized`, protocolo SMB.
- CAE storage definition: `mcp-data-storage`, account key vía `listKeys()` en Bicep (Container Apps no soporta managed identity para mounts SMB).
- Helpers tipados en `src/lib/storage.ts`: `readFile`, `writeFile`, `listFiles`, `appendAuditLine`. Todos validan paths contra traversal (`StoragePathError`) y envuelven errores de filesystem en `StorageReadError` / `StorageWriteError`.
- La carpeta local `data/` se sincroniza al share con `mcp-server/scripts/upload-data-to-share.mjs` (idempotente, usa la account key sembrada en KV con `seed-storage-key-secret.mjs`).

**Cache opcional dormant: blob containers `cache-cmf` / `cache-rpsf` / `audit` quedan aprovisionados** en `infra/modules/storage.bicep` pero:

- Sin role assignment en `mcp-identity.bicep` (`Storage Blob Data Contributor` removido).
- `bootstrapCache()` hace fallback a `createInMemoryStore` cuando falta `AZURE_STORAGE_ACCOUNT_NAME` (env var no configurada).
- `createBlobStore` queda en `cache.ts` ready-to-wire para casos donde un tool futuro requiera cache distribuido entre réplicas con semántica de TTL real (no "snapshot estable").

## Consecuencias

### Positivas

- **Una sola fuente de verdad para snapshots y normativas.** El runtime y los humanos miran la misma jerarquía.
- **Lectura sin SDK.** PDFs, MD y CSVs se acceden con `fs.readFile`. Tests pueden usar `tmpdir()` con `DATA_DIR` override.
- **Audit append nativo.** `audit/<YYYY-MM-DD>.jsonl` con `fs.appendFile` evita la complejidad de blob append blobs y sus límites de operaciones.
- **Bootstrap explícito y reproducible.** Un script (`upload-data-to-share.mjs`) sincroniza el repo al share. El primer deploy ya tiene los datos disponibles sin esperar a que `refresh-cmf` corra.
- **Roles del MCP minimizados.** La UAI solo tiene `AcrPull` + `Key Vault Secrets User`. Reduce blast radius.

### Negativas

- **Account key como secret al portador.** El CAE storage definition no acepta managed identity para mounts SMB. La key vive en Key Vault (`storage-account-key`) y debe rotarse manualmente. Mitigación: rotación documentada, scope limitado a operaciones de file share, no se propaga a runtime de la app (la app solo ve `/app/data` como filesystem).
- **Performance SMB para archivos pequeños.** Lectura de PDFs ~2MB tarda <500ms en TransactionOptimized; aceptable para snapshots cargados al boot. Si llega un caso de muchos archivos pequeños con I/O random, evaluar caché en memoria al boot o mover ese subconjunto a NFS / Premium.
- **Mount estable depende del CAE.** Restart del CAE storage definition reinicia los mounts. No es problemático en la práctica (verificado en S1.6 con `revision restart`).
- **Costo File Share TransactionOptimized + 100 GiB.** Aproximadamente <$5/mes con poco tráfico. Verificado en Checkpoint A (storage-volume-s1).

### Neutrales

- `@azure/storage-blob` permanece como dependencia. Costo: bundle size + audit superficie. Beneficio: si un tool futuro lo necesita, el código `createBlobStore` está testeado y wired solo falta cablear.

## Alternativas consideradas

### Alternativa 1: Solo Blob Storage (status quo del SPEC original)

- Ventaja: API REST uniforme, RBAC granular por container, sin account key en CAE.
- Descartada porque: dos rutas de seed (manual vs `refresh-cmf`), SDK obligatorio para lecturas simples (PDFs, MD), append blobs son menos ergonómicos para audit logs JSONL.

### Alternativa 2: Azure Files NFS v4.1 en lugar de SMB

- Ventaja: mejor performance para muchos archivos pequeños, soporta managed identity.
- Descartada porque: requiere VNET integration en el CAE (cambio mayor de infra), HNS habilitado en el storage account, region específica. Para nuestro perfil de uso (pocos archivos grandes leídos al boot + audit append), SMB con account key alcanza.

### Alternativa 3: EmptyDir / volumen efímero

- Ventaja: sin storage account adicional, sin account key.
- Descartada porque: el contenido se pierde en cada restart de réplica. Audit append y snapshots versionados requieren persistencia real.

### Alternativa 4: Eliminar completamente los blob containers

- Ventaja: cero deuda visual en `storage.bicep`, mensaje arquitectónico claro ("todo va por File Share").
- Descartada porque: re-aprovisionar containers después tiene fricción operacional; mantenerlos vacíos cuesta cero dolar. La opción dormant da flexibilidad para tools que en el futuro genuinamente necesiten cache distribuido (ej: full_evaluation con coordinación entre réplicas).

## Implementación

Implementación dividida en cinco slices verticales (ver [tasks/plan-storage.md](../../tasks/plan-storage.md)):

- **S1** (commits `2610ed3` … `02975b3`): File Share + CAE storage definition + volumeMount.
- **S2** (commits `36fd7dc`, `229f36c`): scripts de bootstrap (seed key, upload data) + sección README.
- **S3** (commit `7d9e593`): `src/lib/storage.ts` con helpers tipados y guard anti-traversal.
- **S4** (commit `c1398af`): role `Storage Blob Data Contributor` removido; containers marcados dormant.
- **S5** (este ADR + actualización de SPEC §2/§3.6/§3.7 + `tasks/plan.md`).

## Referencias

- SPEC.md §2 (Tech stack), §3.6 (RBAC), §3.7 (Data sources & local snapshots) — actualizadas en commit `c1398af`.
- `infra/modules/storage.bicep` — File Share + containers dormant.
- `infra/modules/container-apps-env.bicep` — CAE storage definition `mcp-data-storage`.
- `mcp-server/scripts/seed-storage-key-secret.mjs` y `upload-data-to-share.mjs` — bootstrap.
- `mcp-server/src/lib/storage.ts` — API runtime con tests en `storage.test.ts`.
- Commit `b87c2d9` (revert AZURE_STORAGE_ACCOUNT_NAME) — señal arquitectónica que motivó la formalización de este ADR.
