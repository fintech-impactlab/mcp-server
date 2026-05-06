# SPEC — Cruce Chile MCP Server

> Spec técnica del servidor MCP. Para el "por qué" del proyecto, contexto regulatorio chileno y narrativa, ver [README.md](README.md).
> Para infraestructura Azure, ver [tasks/plan.md](tasks/plan.md). Para plan de implementación, ver [tasks/plan-tools.md](tasks/plan-tools.md).
>
> Ámbito: solo `mcp-server/`. Cliente web demo, extensión de navegador y bots SMS/WhatsApp tienen specs separados cuando se construyan.

---

## 1. Objective

**Cruce Chile MCP Server** es un servidor [Model Context Protocol](https://modelcontextprotocol.io) que expone **11 tools granulares + 1 tool de orquestación** sobre fuentes públicas chilenas (CMF, SII, NIC Chile, FinteChile, Banco Central, BCN Ley Fácil) y globales (PhishTank, Google Safe Browsing, URLhaus). Cualquier cliente MCP — Claude Desktop, agente custom, navegador, app móvil — puede consumirlo para verificar entidades financieras chilenas con datos auditables.

**Outcome:**
- Endpoint MCP sobre Streamable HTTP en `ca-mcp-<env>` (ingress interno).
- Cada tool retorna **hechos crudos + score parcial determinístico + razones**, nunca opinión.
- Sin LLM dentro del MCP. Toda lógica de scoring y orquestación es código auditable.

**Non-goals** (resumen — ver sección "Lo que el MCP NO hace" del README para detalle):
- No genera borradores de denuncia.
- No envía denuncias automáticamente.
- No bloquea sitios.
- No traduce a lenguaje simple (excepto vía `explain_law_simple`, que solo expone respuesta de BCN).
- No persiste consultas individuales.

---

## 2. Stack

Confirmado en `mcp-server/package.json` (bootstrap actual) y planeado para Cluster B:

| Capa | Decisión | Estado | Razón |
|---|---|---|---|
| Runtime | Node 22 (`engines.node: ">=22"`, `node:22-alpine` en Dockerfile) | ✅ instalado | Test runner nativo estable, perf, soporte LTS hasta abr-2027. |
| Package manager | `pnpm` 10.33.0 vía Corepack | ✅ instalado | Lockfile reproducible, faster installs, respeta strict deps. |
| Lenguaje | TypeScript 5.6.3 con `strict: true` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch` | ✅ instalado | Política CLAUDE.md y +. Sin `any` implícitos, accesos a índice tipados como `T \| undefined`. |
| Módulos | ESM (`"type": "module"`, `module: "NodeNext"`) | ✅ instalado | Alineado con MCP SDK y Node 22 nativo. |
| MCP SDK | `@modelcontextprotocol/sdk` 1.29.0 (Streamable HTTP transport, stateless) | ✅ instalado | Transport remoto requerido por arquitectura Container Apps. stdio no aplica. |
| HTTP server | `express` 4.21.2 | ✅ instalado | Middleware ergonómico (body limit, futuras CORS/rate-limit). MCP SDK monta sobre el transport HTTP. |
| HTTP client (outbound) | `undici` | ⏳ a sumar en Slice 0 | Timeouts, abort signals y retries más controlables que fetch nativo. Pool de conexiones. |
| Validación | `zod` v3+ | ⏳ a sumar en Slice 0 | Validar todo input externo en bordes (CLAUDE.md). |
| XLSX parser | `exceljs` | ⏳ a sumar en Slice 4 (solo job `refresh-cmf`) | El runtime de tools **no** parsea XLSX: lee CSV ya normalizado desde `/app/data/snapshots/cmf/` (File Share, ver ADR-001). Solo el job programado `refresh-cmf` baja el XLSX desde CMF Alertas y lo convierte. Mantenimiento activo, types modernos, sin CVEs abiertas. |
| CSV parser (runtime) | built-in (Node `string.split` + Zod) | ⏳ a sumar en Slice 4 | Los CSVs de CMF tienen shape simple (encabezados + filas planas). Sin dep extra a menos que aparezca un campo con escape complejo; entonces evaluar `csv-parse`. |
| HTML scraping | `cheerio` | ⏳ a sumar en Slice 4-8 | Para SII, dequienes.cl, FinteChile, CSIRT. Liviano, sin browser headless. |
| WHOIS / RDAP | `whois-json` + cliente RDAP custom | ⏳ a sumar en Slice 6-7 | NIC Chile expone RDAP. Internacional vía WHOIS. |
| Test framework | Node test runner nativo (`node --test --test-reporter=spec`) | ✅ instalado | Cero dependencias extra, ESM nativo, watch built-in en Node 22. Ver Open question 4 si cobertura no alcanza. |
| Coverage | `node --experimental-test-coverage` | ⏳ a habilitar en Slice 1 | Requisito 100% en motor de scoring + parsers (CLAUDE.md). |
| Lint | `eslint` + `@typescript-eslint` | ⏳ a sumar en Slice 0 | Custom rule para bloquear `console.log` con argumentos no hasheados. |
| Format | `prettier` | ⏳ a sumar en Slice 0 | Default config, ancho 100. |
| Persistencia activa | Azure Files SMB montado en `/app/data` (`DATA_DIR`) | ✅ provisto por infra (storage-volume-s1) | Helpers tipados en `src/lib/storage.ts` con guard anti path-traversal. Layout: `snapshots/cmf/`, `snapshots/rpsf/`, `normativas/`, `audit/<YYYY-MM-DD>.jsonl`. Fuente única de verdad runtime. Ver ADR-001. |
| Cache opcional (dormant) | `@azure/storage-blob` + `createBlobStore` | ⏸ aprovisionado, no cableado | Containers `cache-cmf`, `cache-rpsf`, `audit` quedan creados en `infra/modules/storage.bicep` pero sin role assignment. `bootstrapCache()` hace fallback a in-memory cuando falta `AZURE_STORAGE_ACCOUNT_NAME`. Reabrir solo si un tool futuro requiere cache distribuido entre réplicas que no encaje en File Share. |
| Secrets | `@azure/identity` + `secretRef` en Container Apps | ⏳ Identity SDK a sumar; secretRef definido en infra Slice 7.1 | KV vía managed identity. Cero secretos en env vars de runtime. |
| Telemetría | **Logs JSON estructurados a stdout** → Container Apps Console Logs → Log Analytics workspace `log-fintech-${env}` (provisto por infra Slice 2.2). | ⏳ wrapper a sumar en Slice 0 | Sin SDK adicional, sin costo de ingestión App Insights. Queries vía `az monitor log-analytics query`. |
| App Insights SDK | `applicationinsights` | ⏸ deferred | Decisión actual: no usar. La infra Slice 7 (App Insights wiring + alertas) queda diferida. Reabrir si: (a) llega requerimiento de APM detallado / Live Metrics, (b) los logs de LA no alcanzan para correlación distribuida, (c) se suma OTel y App Insights es el sink natural. |

---

## 3. Tool contracts

### 3.1 Lista canónica de tools

| Etapa | Tool | Input | Fuente principal |
|---|---|---|---|
| 1 | `check_blacklist` | RUT \| URL \| dominio \| nombre | CMF Alertas + PhishTank + GSB + URLhaus + CSIRT |
| 1 | `check_whitelist` | RUT \| URL \| nombre | CMF RPSF + FinteChile |
| 2 | `analyze_domain` | URL | WHOIS + TLS + redirect chain |
| 2 | `check_dns_ownership` | dominio | NIC Chile (RDAP) / WHOIS internacional |
| 3 | `verify_chilean_entity` | RUT | SII Situación Tributaria + dequienes.cl |
| 3 | `check_regulator_status` | RUT \| nombre | CMF RPSF + FinteChile + clasificador interno |
| 3 | `analyze_business_model` ⚠️ | URL \| descripción | reglas determinísticas + cruce con `get_market_reference_rates` |
| 3 | `get_market_reference_rates` | (vacío) | API BDE Banco Central |
| 4 | `get_applicable_regulation` | tipoEntidad + situacion | catálogo en código |
| 4 | `explain_law_simple` | leyId + articulo? | API BCN Ley Fácil |
| 4 | `get_official_complaint_channels` | tipoEntidad + tipoSituacion | catálogo en código |
| 5 | `full_evaluation` | RUT \| URL \| nombre | orquestación determinística de etapas 1-4 |

### 3.2 Shape base de respuesta

Toda tool retorna un objeto que extiende este shape. Definido en `src/lib/schemas.ts`:

```typescript
const BaseToolResponse = z.object({
  score: z.number().int().min(-100).max(100), // score parcial aportado por esta tool
  reasons: z.array(z.object({
    ruleId: z.string(), // referencia a regla en src/scoring/rules.ts
    weight: z.number().int(),
    message: z.string(),
    fundamento: z.string(), // por qué esta regla aporta este peso
  })),
  sources: z.array(z.object({
    name: z.string(), // "cmf-alertas-plataformas", "phishtank", "bce-bde", etc.
    url: z.string().url().optional(), // URL pública si aplica
    fetchedAt: z.string().datetime(), // ISO 8601 UTC
    dataAvailable: z.boolean(), // false si la fuente cayó / cuota agotada
    staleSince: z.string().datetime().optional(), // si se sirvió cache expirado
  })),
  disclaimer: z.string().optional(), // obligatorio en analyze_business_model
});
```

Cada tool extiende este shape con campos específicos (ej: `inBlacklist`, `domainAge`, `rates`, etc.).

### 3.3 Modelo de errores

- **Tipados por fuente.** Cada fuente externa tiene su clase: `BCEError`, `BCNError`, `CMFFetchError`, `PhishTankError`, `SafeBrowsingError`, `URLhausError`, `CSIRTError`, `SIIError`, `DequienesError`, `NICError`, `FinteChileError`, `WHOISError`, `TLSError`. Todas extienden `ToolError`.
- **Campos:** `source: string`, `cause: unknown` (causa original), `retriable: boolean`, `userFacing: string`.
- **Política:** dentro del MCP, los errores de fuentes externas **no rompen la cadena**. Se capturan, se retorna `dataAvailable: false` para esa fuente, y el scoring continúa con datos parciales.
- **Timeouts:** 5s por request a fuente externa, 8s timeout global para tools multi-fuente, 30s para `full_evaluation`.
- **Retries:** 3 intentos con backoff exponencial (1s, 2s, 4s) solo para errores `retriable: true` (timeouts, 5xx, 429 con `Retry-After`).

### 3.4 Transport

- **Streamable HTTP** sobre el endpoint MCP de `ca-mcp-<env>`. Ingress interno (no expuesto a internet — clientes consumen vía DNS interno del Container Apps Environment).
- Modo **stateless**: `sessionIdGenerator: undefined`. Se crea un `StreamableHTTPServerTransport` por request POST y se cierra con `res.on("close", ...)`. Ningún estado entre requests.
- `GET /mcp` retorna 405 con error JSON-RPC (`code: -32000, message: "Method not allowed (stateless mode)"`). Solo `POST /mcp` es válido para el protocolo.
- `GET /health` retorna `{ status: "ok", name: "fintech-mcp", version: "0.1.0" }` con 200. Usado por probes de Container Apps y por `ca-web` para validar liveness.
- Body limit de Express: `1mb` (`express.json({ limit: "1mb" })`).
- Cliente externo expuesto al ciudadano vive en otro Container App (`ca-web-<env>`) o futuros canales (extensión, app SMS), no en este server.

### 3.5 Consumer contract (web y futuros clientes)

Cómo otros componentes del CAE deben consumir este MCP. Documentado para que cualquier cliente nuevo (web demo, extensión de navegador, app SMS) lo use uniforme:

- **URL canónica interna:** `http://ca-mcp-<env>` (FQDN corto, resuelto por DNS interno del CAE). Los clientes la reciben vía env var `MCP_URL`. Nunca hardcodear el FQDN largo `*.azurecontainerapps.io`.
- **Health probe desde cliente:** `fetch(${MCP_URL}/health, { cache: "no-store", signal: AbortSignal.timeout(2000) })`. Timeout 2s. Convención adoptada por `ca-web` (ver `web/README.md`).
- **Resiliencia del lado consumer:** si el MCP cae (timeout, 5xx, DNS), el cliente **no debe propagar 5xx** a su propio usuario. Renderiza estado degradado (mensaje de "MCP no disponible") con HTTP 200. El MCP es dependencia, no SPOF visible.
- **Identidad para llamadas autenticadas:** dentro del CAE no hay autenticación de aplicación entre containers (red privada). Si en el futuro se añade autenticación entre componentes, será vía managed identity + token de Entra ID.

### 3.6 Deployment & identity model

El MCP corre como Container App `ca-mcp-<env>` con **User-Assigned Identity** dedicada (`uai-mcp-<env>`), separada de la del web (`uai-web-<env>`):

| Recurso | Permiso de `uai-mcp-<env>` | Razón |
|---|---|---|
| ACR (`<acr>`) | `AcrPull` | Container Apps jala la imagen sin admin user. |
| Key Vault (`<kv>`) | `Key Vault Secrets User` | Lectura de secrets vía `secretRef` (API keys de PhishTank, GSB, BCE; bearer keys del MCP). |
| Storage Account (`<storage>`) | _(sin role asignado)_ | El File Share `mcp-data` se monta vía CAE storage definition (account key, no MI; ver ADR-001). Los blob containers quedan dormant (no se acceden desde runtime). Si un tool futuro cablea `createBlobStore`, asignar `Storage Blob Data Contributor` en ese momento. |

**Decisiones derivadas:**

- Separación `uai-mcp-<env>` vs `uai-web-<env>` es **deliberada**. `uai-web-<env>` solo tiene `AcrPull`; el web no toca KV ni Storage. Reduce blast radius de un compromiso del front.
- Código del MCP usa `DefaultAzureCredential` de `@azure/identity`. En Container Apps resuelve a la UAI inyectada; en dev local resuelve al `az login` del developer.
- Cualquier nuevo recurso Azure consumido por el MCP requiere asignar el rol mínimo a `uai-mcp-<env>` en Bicep (`infra/`). No reusar permisos heredados.
- **No usar system-assigned identity.** UAI permite controlar el ciclo de vida del principal independiente del Container App (re-deploys no rotan la identidad).

### 3.7 Data sources & local snapshots (`data/`)

El repo tiene una carpeta `data/` en la raíz (fuera de `mcp-server/`) que documenta el README en su sección ["Datos y referencias locales"](README.md#datos-y-referencias-locales-data). Vive aparte del server para que cualquier integrante del lab pueda revisar/refrescar fuentes sin tocar el código.

| Carpeta / archivo | Contenido | Rol |
|---|---|---|
| `data/*.csv` | Snapshots vigentes de los 4 listados de CMF Alertas Ciudadanas (Plataformas / Apps Crédito / Créditos Fraudulentos / Otras), convertidos desde XLSX. | Source de bootstrap del File Share + fixture para tests. En runtime se lee desde `/app/data/snapshots/cmf/`. |
| `data/normativas/*.{pdf,md}` | NCG 502/503/504/514, Manual SIF, Circ 2.345 (PDF original + texto plano `pdftotext -layout`). | Source de bootstrap del File Share. En runtime se lee desde `/app/data/normativas/` (incluye subcarpeta `sii/`). |
| `data/APIS.md` | Documentación técnica consolidada de las 5 APIs REST (BCE BDE, BCN Ley Fácil, PhishTank, GSB v4, URLhaus): endpoints, auth, parámetros, ejemplos request/response, rate limits, mapping de credenciales a Key Vault, política de timeouts/retries/cache. | Source-of-truth para implementar `tools/<name>/client.ts`. Documento para humanos, **no** se sube al File Share. |

**Decisión: `data/` se sincroniza al File Share `mcp-data` (montado en `/app/data`).** Tres caminos se evaluaron:

- (A) Cargar CSVs al blob `cache-cmf` al deploy y leer solo del blob. _Descartada:_ duplica la lógica de seed; requiere SDK adicional para lectura.
- (B) `COPY data/` en el Dockerfile y leer con path relativo. _Descartada:_ acopla Docker build a archivos fuera de `mcp-server/`, complica imagen y CI.
- **(C) elegida (revisada en ADR-001):** `data/` vive en el repo como fuente versionada y se sincroniza al File Share `mcp-data` con `mcp-server/scripts/upload-data-to-share.mjs`. La Container App MCP monta el share en `/app/data` (`DATA_DIR`). Helpers tipados en `src/lib/storage.ts` resuelven paths con guard anti-traversal.

**Relación con `__fixtures__/`:**

- `data/*.csv` = snapshot completo y vigente del listado real (todo lo que CMF expuso a la fecha de refresh). Refresca un humano + una herramienta.
- `mcp-server/src/tools/<name>/__fixtures__/` = subconjuntos curados o casos edge (un fraude conocido, una fila malformada, un listado vacío, etc.) usados por tests específicos. Mantenidos a mano.

**Refresh operacional:** los snapshots CMF se actualizan vía PR cuando el equipo decide bumpar el snapshot de referencia (no automáticamente). Tras el merge se re-corre `mcp-server/scripts/upload-data-to-share.mjs` para sincronizar al File Share. Cuando exista `pnpm refresh:cmf` (Slice 4.2), correrá como Container Apps Job programado y persistirá directamente a `/app/data/snapshots/cmf/` (no al blob `cache-cmf`).

---

## 4. Project structure

```
mcp-server/
├── package.json                    # ESM, pnpm@10.33.0, node>=22
├── pnpm-lock.yaml
├── tsconfig.json                   # strict + noUncheckedIndexedAccess + noImplicitOverride + noFallthroughCasesInSwitch, target ES2022, module NodeNext
├── .eslintrc.cjs                   # custom rule: no-unhashed-log
├── CONVENTIONS.md                  # patrón fijo para nuevas tools (escrito en Slice 0)
├── Dockerfile                      # multi-stage builder + deps + runtime, node:22-alpine
├── .dockerignore                   # excluye .env*, node_modules, .git, *.md, **/__fixtures__
└── src/
    ├── index.ts                    # bootstrap actual: Express + McpServer + StreamableHTTPServerTransport (POST /mcp stateless, GET /health)
    ├── server/
    │   └── registry.ts             # registerTool(server, tool) — a crear en Slice 0.7
    ├── lib/
    │   ├── logging.ts              # hashInput + emitter de logs JSON a stdout (un objeto por línea)
    │   ├── cache.ts                # getOrSet con in-memory store (default) o Blob (dormant, ver ADR-001)
    │   ├── storage.ts              # filesystem helpers contra DATA_DIR (/app/data) con guard anti path-traversal
    │   ├── http.ts                 # undici client con defaults (timeout, retry, UA)
    │   ├── errors.ts               # ToolError + subclases por fuente
    │   └── schemas.ts              # BaseToolResponse, Source, Reason, Facts
    ├── scoring/
    │   ├── rules.ts                # tabla declarativa Rule[]
    │   ├── engine.ts               # score(facts) → { score, reasons }
    │   └── __tests__/rules.test.ts # caso afirmativo + negativo por regla
    ├── tools/
    │   └── <tool_name>/            # 12 carpetas, una por tool
    │       ├── index.ts            # export default { name, description, inputSchema, handler }
    │       ├── schema.ts           # input + output Zod
    │       ├── client.ts           # cliente de fuente externa (puede ser varios para multi-fuente)
    │       ├── parsers/            # opcional, parsers de XLSX/HTML
    │       ├── __fixtures__/       # snapshots congelados de fuente
    │       └── <tool_name>.test.ts # ejecutado vía `node --test dist/**/*.test.js`
    ├── constants/
    │   ├── laws.ts                 # 11 leyes del README
    │   ├── cmf-norms.ts            # NCG 502/503/504/514, Manual SIF, Circ 2.345
    │   ├── regulation-matrix.ts    # mapping (tipoEntidad, situacion) → leyes[]
    │   ├── channels.ts             # CMF, SERNAC, CSIRT, denuncia penal
    │   └── channels-matrix.ts      # mapping → canales[]
    └── jobs/
        ├── refresh-cmf.ts          # script para refrescar /app/data/snapshots/cmf/ (cron diario en Container Apps Job)
        └── refresh-rpsf.ts         # script semanal, persiste a /app/data/snapshots/rpsf/
```

---

## 5. Commands

Gestor de paquetes: **pnpm**. Ejecutados desde `mcp-server/`:

| Comando | Estado | Propósito |
|---|---|---|
| `pnpm dev` | ✅ | Compila en watch (`tsc --watch`). Para hot-restart del server, encadenar con `node --watch dist/index.js` en otra terminal. |
| `pnpm build` | ✅ | Compila TS → `dist/` (`tsc`). |
| `pnpm start` | ✅ | Ejecuta `node dist/index.js` (usado en imagen Docker). |
| `pnpm typecheck` | ✅ | `tsc --noEmit`. |
| `pnpm test` | ✅ (placeholder) | Hoy: `node --test --test-reporter=spec dist/**/*.test.js`. Requiere `pnpm build` previo. |
| `pnpm test:watch` | ⏳ | `node --test --watch --test-reporter=spec` sobre fuente compilada (Slice 0). |
| `pnpm test:coverage` | ⏳ | `node --experimental-test-coverage --test dist/**/*.test.js`; CI falla si scoring/ <100% (Slice 1). |
| `pnpm lint` | ⏳ | ESLint + custom rule de logging hasheado (Slice 0). |
| `pnpm scoring:docs` | ⏳ | Genera `SCORING.md` desde `src/scoring/rules.ts` (Slice 1.4). |
| `pnpm refresh:cmf` | ⏳ | Descarga 4 XLSX de CMF Alertas y persiste CSVs en `/app/data/snapshots/cmf/` (File Share, Slice 4.2). |
| `pnpm refresh:rpsf` | ⏳ | Scraping CMF RPSF + FinteChile, persiste en `/app/data/snapshots/rpsf/` (Slice 5.3). |

CI ejecuta: `lint`, `typecheck`, `test:coverage`, `build` antes del docker build (infra Slice 8.3).

---

## 6. Code style

### 6.1 TypeScript

- `strict: true` en `tsconfig.json`. Sin `any` implícitos.
- Flags adicionales activas: `noUncheckedIndexedAccess` (todo `arr[i]` es `T | undefined`), `noImplicitOverride`, `noFallthroughCasesInSwitch`. No relajar.
- Módulos ESM. Imports con extensión `.js` cuando apuntan a archivos del proyecto (requerido por `module: "NodeNext"`).
- `@ts-ignore` solo con comentario que justifique en la misma línea.
- Tipos exportados desde el módulo donde se definen; no hay `types/` central.
- Imports relativos: `./` y `../`. Sin alias `@/` (innecesarios para el tamaño).
- `import type` para imports puramente tipográficos.

### 6.2 Validación

- **Zod en bordes.** Toda respuesta de fuente externa pasa por `.safeParse()`. Falla → error tipado por fuente.
- **Inputs hostiles por defecto.** RUT, URL, dominio se sanitizan: trim, lowercase para dominios, validación de formato RUT (módulo 11), URL parseada con `URL` constructor.
- Nunca `eval`, `new Function`, `child_process` con input del usuario.

### 6.3 Errores

- Sin `throw new Error("...")` genéricos. Siempre clase tipada con `source`.
- Errores de validación Zod se convierten a la clase de la fuente: `BCEError({ source: "bce", cause: zodError, retriable: false, userFacing: "Respuesta BCE inválida" })`.

### 6.4 Logging

- Función `hashInput(s: string): string` retorna `sha256(s).slice(0,8)`. Obligatoria para todo log que toque RUT, URL, dominio, nombre de empresa o cualquier input del usuario.
- **Sink:** stdout en formato JSON Lines (un objeto JSON por línea, sin pretty-print). Container Apps captura stdout y lo enruta a Log Analytics workspace `log-fintech-${env}` (tabla `ContainerAppConsoleLogs_CL`, mensaje en columna `Log_s`). Sin App Insights SDK por ahora (ver § 2 deferred).
- **Helper:** `logger.event(name, payload)` en `src/lib/logging.ts`. Emite a stdout `{ ts, level, event, ...payload }`. Nunca incluye plaintexts de inputs sensibles ni de bearer tokens.
- **Eventos canónicos:**
  - `tool.call` con payload `{ toolName, clientId, inputHash, durationMs, success, sources?, errors? }`.
  - `auth.failure` con payload `{ reason: "no_header" | "invalid_key" | "revoked", inputHash, ip? }`.
  - `tool.error` con payload `{ toolName, source, message, retriable }`.
- **Queries operacionales:** `az monitor log-analytics query --workspace <ws-id> --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'ca-mcp-fintech-${env}' | extend log = parse_json(Log_s) | where log.event == 'tool.call' | take 20"`.
- Sin `console.log` directo en código producción; usar `logger.event` o `logger.info|warn|error` (que internamente hacen `console.log(JSON.stringify(...))`). Custom ESLint rule (Slice 0.3) bloquea `console.*` directo y argumentos no hasheados.

### 6.5 Determinismo

- Sin LLM en `src/scoring/`, `src/tools/full_evaluation/`, ni en parsers.
- Sin `Math.random`, sin `Date.now()` dentro de `score()` (Date.now solo en sources.fetchedAt y trazas).
- Mismo input → mismo output, siempre.

### 6.6 Comentarios

- Default: no escribir comentarios. Nombres descriptivos. Docs en SPEC y CONVENTIONS.
- Excepción: regla del scoring engine con `fundamento` no obvio o workaround para bug específico de una fuente externa. Una línea, hecho concreto.

---

## 7. Testing strategy

### 7.1 Frameworks y convenciones

- **Node test runner nativo** (`node:test` + `node --test`). Sin Vitest. Estable en Node 22.
- Tests escritos en TypeScript, compilados a `dist/` y ejecutados desde ahí: `node --test --test-reporter=spec dist/**/*.test.js`.
- Mocks: `node:test` provee `mock` (`mock.fn`, `mock.method`, `mock.timers`). Suficiente para clientes externos.
- Cobertura: `node --experimental-test-coverage` (V8-based, output `lcov` para CI).
- Convención: tests viven junto al código (`<file>.test.ts`), excepto tests de scoring que viven en `src/scoring/__tests__/`.
- **Fixtures por tool** en `__fixtures__/`: subconjuntos curados / casos edge (fraude conocido, fila malformada, listado vacío). Cargados con `fs.readFileSync` desde `import.meta.dirname`.
- **Snapshots versionados de fuente** en `<repo>/data/` (CSVs CMF, PDFs/`.md` normativas). Tests pueden referenciarlos con path relativo `../../../data/<file>` cuando necesitan el listado completo y vigente; el repo-root layout lo permite porque tests no corren en Docker. Ver § 3.7 para la separación entre `data/` y `__fixtures__/`.

### 7.2 Cobertura obligatoria

| Área | Cobertura mínima | Razón |
|---|---|---|
| `src/scoring/rules.ts` | 100% líneas + branches | CLAUDE.md: cada regla con caso afirmativo y negativo. |
| `src/scoring/engine.ts` | 100% | Lógica determinística, debe estar 100% probada. |
| `src/tools/<tool>/parsers/` | 100% | Parser de fuente externa con fixture congelado. Detecta drift de markup. |
| `src/tools/<tool>/client.ts` | ≥90% | Test contra fixture + test de fallo (timeout, error tipado, schema inválido). |
| `src/lib/` | ≥90% | Helpers compartidos, alto blast radius. |
| `src/server/` | ≥80% | Bootstrap, menos crítico. |

CI falla si la cobertura de `scoring/` cae bajo 100%.

### 7.3 Tipos de tests por tool

Cada tool nueva debe incluir:

1. **Test de cliente** con fixture: respuesta válida → parseo correcto.
2. **Test de cliente** con fuente caída: lanza error tipado correcto.
3. **Test de cliente** con respuesta malformada: lanza error con `cause` Zod.
4. **Test de scoring**: una entrada por cada regla aplicable (afirmativo + negativo).
5. **Test de handler E2E** con cliente mockeado: shape de respuesta válida según schema.
6. **Test de fallback**: cliente lanza error → respuesta retorna `dataAvailable: false`, no rompe.

### 7.4 Cache testing

- Tests de `src/lib/cache.ts` corren contra el `createInMemoryStore` (default activo). Si en el futuro se reactiva el blob backend (ADR-001), reabrir `Azurite` en docker con servicio `azurite` previo al test job. Tests de `src/lib/storage.ts` usan `tmpdir()` con `DATA_DIR` override por test.
- Tests in-memory para verificar fallback en dev sin Azure.

### 7.5 Determinismo

- Test específico: 1000 invocaciones de `score(facts)` con mismo input → mismo output exacto. Detecta cualquier source de no-determinismo.

---

## 8. Security & operational boundaries

### Always do

- Validar todo input externo con Zod antes de procesar.
- Hashear con `hashInput` cualquier RUT, URL, dominio o nombre antes de loguear.
- Usar la UAI `uai-mcp-<env>` (vía `DefaultAzureCredential`) para todo acceso a Key Vault. El File Share `/app/data` se monta vía CAE storage definition (account key, no MI; ver ADR-001). Nunca strings de conexión en runtime.
- Asignar el rol mínimo a `uai-mcp-<env>` en Bicep cuando se sume un recurso Azure nuevo.
- Usar `secretRef` en Container Apps para inyectar secretos desde KV. Nunca env var directa con secreto.
- Timeouts explícitos en todo request a fuente externa (5s default).
- Rate limit respetuoso a fuentes scrapeadas: máximo 1 req/s por fuente.
- Cache con TTL apropiado por tipo de fuente (tasas BCE 24h, leyes BCN 7d, RPSF 24h, CMF Alertas 24h). Backend default in-memory por réplica; persistencia entre réplicas vía `/app/data` o (futuro) blob dormant.
- Disclaimer obligatorio en `analyze_business_model`.
- Citar fuente y `fetchedAt` en todo `Source` retornado.
- Retornar `dataAvailable: false` cuando una fuente cae; nunca romper el verdict por una fuente.

### Ask first about

- Agregar dependencia npm nueva (auditar tamaño, mantenimiento, CVEs antes).
- Cambiar el contrato de input/output de una tool ya publicada (potencial breaking change para clientes).
- Agregar nueva regla al motor de scoring sin fundamento documentado.
- Reducir TTL de cache de fuente scrapeada por debajo de 1h (rate limit risk).
- Cambiar el shape de `BaseToolResponse` (afecta a las 12 tools).
- Modificar el shape del payload de `tool.call` (rompe queries en Log Analytics y dashboards futuros).
- Reusar API key entre dev y prod.
- Cambiar el shape de `data/APIS.md` o el contenido de `data/*.csv` sin actualizar también el código de la tool que las consume (y viceversa). Son contrato co-versionado.

### Never do

- LLM en `src/scoring/` ni en `src/tools/full_evaluation/`. Política dura.
- Hardcodear API keys, RUTs reales, contraseñas, connection strings, datos personales en código, comentarios, fixtures, tests o logs.
- Habilitar ingress externo en `ca-mcp-<env>`. Solo el web (`ca-web-<env>`) está expuesto a internet; el MCP queda detrás del DNS interno del CAE.
- Usar la UAI del web (`uai-web-<env>`) para nada que no sea `AcrPull`. Si una task requiere acceder a KV o Storage, va por `uai-mcp-<env>`.
- Persistir consultas individuales del usuario más allá de telemetría agregada (Ley 21.719 / ARCO+).
- `eval`, `new Function`, interpolación de input en queries.
- `console.log` con argumentos no hasheados que toquen input del usuario.
- `throw new Error("...")` genérico. Siempre clase tipada por fuente.
- Romper la cadena de `full_evaluation` por una fuente caída.
- Saltar timeouts o retries para "ir más rápido".
- Omitir `--no-verify` en commits (CLAUDE.md: investigar el hook que falla, no esquivarlo).
- Generar borradores de denuncia o enviar a CMF/SERNAC desde el MCP.
- Bloquear sitios o redirigir tráfico desde el MCP.

---

## 9. Versioning & compatibility

- **Tools como contrato público.** El nombre, input schema y shape de output de cada tool son interface estable consumida por clientes externos (Claude Desktop, futura extensión, etc.). Cambios breaking requieren ADR.
- **Versionado del server:** SemVer en `package.json`. Tags `v0.x.y` durante el lab; `v1.0.0` al cerrar Cluster B.
- **Versionado de tools individuales:** opcional. Si una tool necesita evolucionar de forma incompatible, se publica como `<name>_v2` y la `v1` queda con deprecation warning durante 1 ciclo.
- **Versionado de schemas:** los schemas Zod evolucionan agregando campos opcionales. Un campo se vuelve required solo en major bump del server.

---

## 10. Resolved decisions

Decisiones cerradas con su resolución y razón. Reabrir solo si cambia el contexto.

- **Test runner → `node --test` nativo.** Reevaluar al cierre de Slice 1 contra 3 criterios objetivos: (a) cobertura `--experimental-test-coverage` llega a 100% en `scoring/` sin gaps, (b) `node:test` `mock` alcanza para clientes multi-fuente del Slice 4, (c) no se siente la falta de snapshots / `describe.each` en parsers. Si alguno falla, migrar a Vitest. Cero deps extra hoy.
- **Cache BCE → prefijo `rates:` en container `audit`.** Sin cambio de infra. Volumen bajo (<10 KB, refresh 24h). Convención de keys: `rates:bce:<dataset>`.
- **Cron jobs → Container Apps Jobs separados, scale-to-zero.** Jobs dedicados por fuente (`refresh-cmf`, `refresh-rpsf`, `refresh-fintechile`), scheduling nativo de Container Apps, trazabilidad y reintentos por job. Requiere 1-3 módulos Bicep nuevos en `infra/` (fuera de este plan, abrir tarea en `tasks/plan.md` cuando llegue Slice 4).
- **Drift legal → revisión trimestral manual.** Calendar reminder, due diligence humana ~1h con operador legal. Cada entrada de `laws.ts` y `cmf-norms.ts` lleva `vigenciaDesde` / `vigenciaHasta?` para anclar la revisión. Sin proceso CI por ahora.
- **Custom domain MCP → out of scope.** Se usa `*.azurecontainerapps.io` interno. Reabrir solo si la extensión de navegador (post-lab) requiere TLS pinning específico.
- **Body limit MCP → `1mb` (default actual de Express).** Suficiente para inputs de tools (RUT, URL, descripción de modelo de negocio). Validar en Slice 0 si algún payload excede; subir solo entonces.
- **Stateless transport → mantener para Slice 0-12.** `sessionIdGenerator: undefined`. Reabrir en Slice 13 si `full_evaluation` necesita streaming progresivo de etapas al cliente.
- **Discrepancia conteo de tools → fuente de verdad es el README raíz (11 + 1).** Acción: alinear `mcp-server/README.md` (cierre realizado fuera de este SPEC).
- **`pnpm dev` hot-reload → agregar script `dev:server` con `node --watch`.** Sin nueva dep. Acción: editar `mcp-server/package.json` (cierre realizado fuera de este SPEC).
- **Auth dev mode → env var `MCP_API_KEYS_LOCAL_JSON`.** El dev arranca el server con un JSON pegado en `.env.local` (ya cubierto por `.gitignore`). Sin dependencia de Azure / `az login`. Divergencia documentada con prod (que sí lee de KV con refresh 60s).
- **Auth RBAC del web → scope a nivel secret (`<kv-id>/secrets/mcp-api-key-web`).** Reduce blast radius si `uai-web-${env}` se compromete. Fallback a vault completo solo si la suscripción no soporta scope-secret (verificación: comando `az role assignment create` retorna error — algunas ofertas como Sponsorship pueden requerir el downgrade). En ese caso, documentar el downgrade en comentario Bicep.
- **Telemetría → logs JSON estructurados a stdout** (sink: Container Apps → Log Analytics workspace `log-fintech-${env}`). **App Insights SDK queda diferido.** Reabrir si llega APM detallado / Live Metrics, si LA no alcanza para correlación distribuida, o si se suma OpenTelemetry y AI es el sink natural. Convención: nunca emitir `auth.success` (volumen alto, redundante con `tool.call.clientId`); sí emitir `auth.failure` y `tool.call`.

## 11. Currently open

Sin items abiertos. Cualquier nueva decisión que requiera juicio se documenta acá antes de implementarse.
