# Todo — Hardening cliente MCP

Cada tarea = un slice vertical (código + verificación). Marcar `[x]` al cerrar. No saltarse checkpoints.

---

## Fase 1 — Quick wins

### T1 · Corregir mensaje de timeout, normalización de URL y logging de cierre
**Archivos:** `lib/mcp-client.ts`
**Cambios:**
- `mcp-client.ts:264`: reemplazar `"30s"` por `` `${TIMEOUT_PER_CALL_MS / 1000}s` `` (o constante derivada).
- `getConfig` (`mcp-client.ts:75`): si `url` termina en `/mcp` o `/mcp/`, no concatenar `/mcp` de nuevo. Centralizar el cálculo de la URL final ahí (devolver `endpoint` ya con `/mcp`) y eliminar el ``${cfg.url}/mcp`` de `mcp-client.ts:181`.
- `closeQuietly` (`mcp-client.ts:188`): cambiar `.catch(() => {})` por `.catch((err) => logger.warn("web.mcp.close_failed", { stage, message: err.message }))`. Pasar `stage` ("client" | "transport") para distinguir.

**Acceptance:**
- [ ] `MCP_URL=https://x.com` y `MCP_URL=https://x.com/mcp` resuelven al mismo endpoint final.
- [ ] Mensaje de error de timeout refleja el valor real de `TIMEOUT_PER_CALL_MS`.
- [ ] Si `transport.close()` falla, aparece un `web.mcp.close_failed` en logs.

**Verificación:**
- `pnpm typecheck && pnpm lint`
- `node scripts/test-sdk-client.mjs` (con ambos formatos de `MCP_URL`)
- Smoke en UI: una evaluación con URL real termina OK.

---

## Checkpoint 1
- [ ] T1 verde.
- [ ] Sin regresiones en evaluación serial.

---

## Fase 2 — Paralelización

### T2 · Reproducir y caracterizar el bug del transport en paralelo
**Archivos:** ninguno (investigación). Salida: `tasks/decision-parallel.md`.
**Pasos:**
1. `node scripts/test-sdk-client.mjs --parallel` contra el MCP real. Capturar el error exacto.
2. Leer `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js` (o `.cjs`) — entender por qué dos `callTool` concurrentes se pisan (probablemente un único request stream por sesión).
3. Revisar el `CHANGELOG.md` del SDK desde 1.29.0 a `latest` por cualquier fix de concurrencia.
4. Escribir `tasks/decision-parallel.md` con: error reproducido, causa raíz, opción elegida (B1/B2/B3) y justificación.

**Acceptance:**
- [ ] Documento de decisión existe y nombra una opción.
- [ ] Si la opción es B2 (bump SDK), la versión target está identificada.

---

### T3 · Implementar paralelización según decisión de T2
**Archivos:** `lib/mcp-client.ts`. Posiblemente `package.json` si B2.

**Si B1 (1 transport por call concurrente):**
- Refactorizar `evaluate()` para que cada call abra su propio `Client+Transport`, ejecute `callTool`, cierre. Envolver en `Promise.allSettled`.
- Agrupar en "rondas" por etapa (`screening` → `tecnico` → `entidad`) si el orden importa, o todo paralelo si no. Confirmar con `TOOL_STAGES`.
- Mantener un único `getConfig()` por evaluación.

**Si B2 (bump SDK):**
- `pnpm up @modelcontextprotocol/sdk@<target>`. Verificar imports siguen siendo válidos.
- Reemplazar el `for` por `Promise.allSettled(calls.map(...))`.
- Validar con `--parallel` que el bug no se reproduce.

**Si B3 (serial optimizado):**
- Bajar `TIMEOUT_PER_CALL_MS` a un valor justificado (ej. 6_000 si p95 actual < 4s).
- Documentar el razonamiento en comentario del archivo (una línea).

**Acceptance:**
- [ ] Latencia p50 de `evaluate()` con input URL (5 tools) reducida vs baseline (medir en T2).
- [ ] `node scripts/test-sdk-client.mjs --parallel` no falla (si B1/B2).
- [ ] Manejo de errores parciales: si 1 de 5 tools falla, las otras 4 entregan resultado.

**Verificación:**
- 3 evaluaciones consecutivas en UI con input distinto. Loggear `durationMs` antes/después.
- `pnpm typecheck && pnpm lint && pnpm build`.

---

## Checkpoint 2
- [ ] T3 verde, decisión documentada.
- [ ] Métricas de latencia capturadas en `tasks/decision-parallel.md`.

---

## Fase 3 — Resiliencia

### T4 · Retry acotado en errores transitorios
**Archivos:** `lib/mcp-client.ts`.
**Cambios:**
- Helper `isTransient(err)`: `true` para `TimeoutError`, errores con código `ECONNRESET`/`ECONNREFUSED`, y respuestas HTTP 5xx (si el SDK los expone). `false` para Zod fail, `isError: true` del tool, o 4xx.
- Wrapper `callToolWithRetry(client, call, signal, attempts = 1)`: 1 reintento con backoff fijo de 250ms en `isTransient`. Cada intento con su propio `AbortSignal.timeout`.
- Loggear `attempt: N` y `web.mcp.retry` cuando se reintente.
- Aplicar también a `client.connect(transport)` (1 reintento, mismo criterio).

**Acceptance:**
- [ ] Tools no transitorios (Zod fail, `isError`) **no** se reintentan.
- [ ] Tool con timeout en intento 1 se reintenta y, si el 2º éxito, el outcome es `ok: true`.
- [ ] Logs muestran `attempt: 2` cuando hay retry.

**Verificación:**
- Test manual: apuntar `MCP_URL` a un endpoint que devuelva 503 una vez y luego 200 (o usar `scripts/test-mcp-second-session.mjs` adaptado).
- Smoke UI: evaluaciones siguen pasando.

---

## Checkpoint 3
- [ ] T4 verde.
- [ ] Confirmar en logs que el retry **no** se dispara en evaluaciones normales (no debe ser ruido).

---

## Fase 4 — Reuso de sesión (condicional)

### T5 · Decidir si Fase 4 se ejecuta
**Salida:** decisión en `tasks/decision-session-reuse.md`.
**Criterio go/no-go:**
- Medir tiempo de `client.connect(transport)` aislado (logger en T2/T3 ya lo cubre si se separa).
- Si `connect_ms < 100` → **no-go**, cerrar el plan.
- Si `connect_ms ≥ 100` y deploy es persistente (Container Apps) → **go**.

---

### T6 · Singleton de cliente MCP (solo si T5 = go)
**Archivos:** `lib/mcp-client.ts`, posiblemente `lib/mcp-pool.ts` nuevo.
**Cambios:**
- Módulo con un `Client` lazy en `globalThis.__mcpClient` (patrón Next dev HMR-safe).
- Health: si `callTool` rechaza con error de transporte, invalidar el singleton y reconectar la próxima vez.
- En desarrollo (`process.env.NODE_ENV !== "production"`), opcionalmente seguir creando uno por request para evitar HMR weirdness — decidir en T5.
- **No** compartir signals entre requests; el signal sigue siendo per-call.

**Acceptance:**
- [ ] 10 evaluaciones consecutivas → 1 sola línea `web.mcp.connect` en logs.
- [ ] Tras matar la sesión MCP server-side y volver a llamar → 1 reconexión y la evaluación pasa.
- [ ] Sin condiciones de carrera entre requests concurrentes (probar con 3 requests en paralelo desde la UI).

**Verificación:**
- `pnpm typecheck && pnpm lint && pnpm build`.
- Carga ligera: bash loop de 10 `curl`/submits, contar conexiones en logs.

---

## Checkpoint 4 (condicional)
- [ ] T6 verde si aplica.
- [ ] PR / commit final con resumen de métricas antes/después.

---

## Estado actual

- Fase 1: ✅ T1 — `getConfig` normaliza `/mcp`, `closeQuietly` loggea, mensaje timeout deriva de constante. Verificado con `scripts/test-t1.mjs` (4 variantes de URL OK).
- Fase 2: ✅ T2+T3 — bug paralelo no se reproduce en SDK 1.29.0 (`tasks/decision-parallel.md`). `Promise.all` implementado. Latencia E2E p50 2300ms → 920ms (2.5x).
- Fase 3: ✅ T4 — `callToolWithRetry` con 1 reintento sobre transitorios (`TimeoutError`, `ECONNRESET`, `ECONN*`, `fetch failed`). Validado con fakes (4/4) y runtime (0 ruido en happy path).
- Fase 4: ✅ T5+T6 — `connect()` p50 348ms → GO. Pool gated por `MCP_POOL`/`NODE_ENV` con TTL 5min y 50 usos máx. Singleton vía `globalThis`. Latencia warm 920ms → 670ms (~27%). Pool eviction y reconexión por error transitorio cubiertos.
