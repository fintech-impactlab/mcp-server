# Conventions — `mcp-server`

Convenciones internas de implementación. Para el contrato externo (tools, transport), ver [SPEC.md](../SPEC.md).

---

## Authentication

Toda llamada a `POST /mcp` requiere `Authorization: Bearer <plaintext>` válido. `/health` y `GET /mcp` (que retorna 405) están excluidos.

### Formato de key

- **Plaintext:** string ≥32 bytes random URL-safe.
  ```ts
  import { randomBytes } from "node:crypto";
  const plaintext = randomBytes(32).toString("base64url");
  ```
  Genera ~43 caracteres URL-safe (`[A-Za-z0-9_-]`). Suficiente entropía para descartar brute-force práctico.

- **Hash en KV:** sha256 del plaintext, base64url, también sin padding.
  ```ts
  import { createHash } from "node:crypto";
  const keyHash = createHash("sha256").update(plaintext).digest("base64url");
  ```

- **Comparación:** `crypto.timingSafeEqual` sobre los buffers de los hashes (no sobre los plaintexts). Ver [`src/server/auth/keys.ts`](src/server/auth/keys.ts).

### Estructura del secret KV

El secret `mcp-api-keys` (en `kv-fintech-${env}-*`) es un JSON array de entries:

```json
[
  {
    "clientId": "web",
    "keyId": "k-2026-05-01",
    "keyHash": "<sha256-base64url>",
    "createdAt": "2026-05-01T00:00:00.000Z",
    "revokedAt": null
  },
  {
    "clientId": "dev",
    "keyId": "k-2026-05-01-dev",
    "keyHash": "<sha256-base64url>",
    "createdAt": "2026-05-01T00:00:00.000Z",
    "revokedAt": null
  }
]
```

Campos:

| Campo | Tipo | Descripción |
|---|---|---|
| `clientId` | string | Identificador del cliente. Convención: minúsculas, snake_case. Ej: `web`, `dev`, `extension`, `sms_bot`. |
| `keyId` | string | Identificador único de la key. Convención: `k-<YYYY-MM-DD>[-<sufijo>]`. Permite múltiples keys activas por cliente durante rotación. |
| `keyHash` | string | sha256 del plaintext, base64url sin padding. |
| `createdAt` | ISO 8601 | Timestamp UTC de creación. |
| `revokedAt` | ISO 8601 \| null | Si está seteado, la key se rechaza aunque el hash matchee. |

### Reglas duras

- **Plaintext nunca persiste** en KV, en código, en tests, en fixtures, en logs ni en mensajes de error. Solo se entrega al cliente una vez en el momento de creación (vía script `bootstrap-mcp-api-keys` o `rotate-key`).
- **Plaintext nunca se loguea**, ni siquiera hasheado con `hashInput`. Si un fallo de auth necesita correlación, se usa `hashInput(authHeaderRecibido)` (sha256:8) y `clientId` (cuando ya se sabe), pero nunca el header completo.
- **Comparación timing-safe** obligatoria. No usar `===` ni `==` sobre hashes.
- **Header excluido de logs por default.** Nunca emitir el contenido de `Authorization` aunque sea para debug. Si se necesita debuggear un fallo, capturar solo `inputHash` y `reason`.

### Modo dev local

Para correr el server sin Azure Key Vault, setear la env var `MCP_API_KEYS_LOCAL_JSON` con el mismo JSON shape que el secret KV. El `KeyStore` la usa en lugar de hacer fetch a KV.

```bash
# Generar y exportar (ver scripts/dev-gen-key.mjs)
pnpm dev:gen-key
# Output: línea con MCP_API_KEYS_LOCAL_JSON='...' y plaintext correspondiente
```

Convención: el `.env.local` está en `.gitignore`. Nunca committear plaintexts.

### Rotación

Procedimiento manual de bolsillo: agregar key nueva al JSON sin marcar la vieja → propagar (60 s cache TTL o `az containerapp revision restart`) → update env var del cliente → revocar la vieja agregando `revokedAt` y volver a pushear. Cero downtime. (`docs/KEY_ROTATION.md` se promueve si la rotación se vuelve frecuente; Slice A4 cerrado sin ejecutar.)

---

## Tools

Convención de estructura, contratos y observabilidad para las **11 tools granulares + 1 tool de orquestación** del [README.md](../README.md). Aplica desde Slice 0 de [tasks/plan-tools.md](../tasks/plan-tools.md) en adelante.

### Estructura de carpetas

Cada tool vive en `src/tools/<tool_name>/` con la siguiente convención fija:

```
src/tools/<tool_name>/
├── index.ts             # export default { name, description, inputSchema, handler }
├── schema.ts            # input Zod + output Zod (extendiendo BaseToolResponse de lib/schemas.ts)
├── client.ts            # cliente de la fuente externa (puede haber varios clientes en multi-fuente)
├── parsers/             # opcional: parsers de XLSX / HTML / WHOIS
├── __fixtures__/        # snapshots congelados anonimizados, commitados (subset edge cases)
└── <tool_name>.test.ts  # tests del handler + cliente, ejecutados vía `node --test dist/**/*.test.js`
```

`<tool_name>` es snake_case en minúsculas y matchea exactamente el `name` declarado en `index.ts` (ej. `check_blacklist`, `get_market_reference_rates`).

Helpers compartidos (no por tool) viven en:

- `src/lib/logging.ts` — `hashInput`, `logger.event`, `setLogSink`.
- `src/lib/schemas.ts` — `BaseToolResponse`, `Source`, `Reason` (Slice 0.5).
- `src/lib/cache.ts` — `getOrSet(key, ttlSeconds, fetcher)` con backend Storage Blob + fallback in-memory (Slice 0.4).
- `src/lib/errors.ts` — `ToolError` y subclases por fuente (Slice 0.2).
- `src/server/registry.ts` — `registerTool(server, tool)` (Slice 0.7).

### Reglas duras

- **Plaintext nunca persiste** (ya cubierto en § Authentication, aplica también acá: ningún input del usuario se loguea raw).
- **Toda respuesta de fuente externa pasa por Zod `.safeParse()`** antes de propagar. Si falla, se lanza la subclase de `ToolError` correspondiente (ej. `BCEError`).
- **`hashInput(s)` es obligatorio** para todo log que toque RUT, URL, dominio o nombre de empresa. La regla operativa: si un argumento de `logger.event` viene de `req` o de input de usuario, debe pasar primero por `hashInput`.
- **Sin LLM en `src/scoring/` ni en `src/tools/full_evaluation/`.** Toda lógica de scoring y orquestación es código auditable.
- **Sin `throw new Error("...")` genérico.** Siempre subclase de `ToolError` con `source`, `cause`, `retriable`, `userFacing`.
- **Timeouts explícitos** en todo request a fuente externa: 5 s default, 8 s en multi-fuente, 30 s en `full_evaluation`.
- **Cache TTL por tipo:** tasas BCE 24 h, leyes BCN 7 d, RPSF 24 h, CMF Alertas 24 h. Reducir TTL bajo 1 h requiere review (rate limit risk).

### Logging canónico

- `tool.call` — emitido por cada handler al cierre, con payload `{ event, toolName, clientId, inputHash, durationMs, success, sources?, errors? }`. `clientId` viene de `res.locals.auth.clientId` (set por `requireBearer`).
- `tool.error` — payload `{ event, toolName, source, message, retriable }`. Solo cuando una fuente externa cae con error tipado.
- `auth.failure` — emitido por `requireBearer` (ya implementado, ver § Authentication).

Sink: stdout en JSON Lines. Sin SDK adicional. Hoy no hay persistencia (CAE con `appLogsConfiguration: null`); reabrir si se reactiva el sink.

### Test conventions

- **Test runner:** `node --test --test-reporter=spec "dist/**/*.test.js"` (sin Vitest).
- **Mocks:** `node:test` provee `mock` (suficiente para inyectar fakes en handlers y clientes).
- **Cobertura:** `node --experimental-test-coverage` cuando se habilite. Requisito 100 % en `src/scoring/rules.ts` y `src/scoring/engine.ts` (Slice 1).
- **Fixtures:** `__fixtures__/<scenario>.{json,html,xlsx,xml}` por tool. Cargados con `loadFixture(name)` (helper de Slice 0.6) usando `import.meta.dirname`.
- **Tests por tool nueva (mínimo):** cliente con fixture válido, cliente con fuente caída, cliente con respuesta malformada, handler E2E con cliente mockeado, handler con error → `dataAvailable: false` sin romper.
