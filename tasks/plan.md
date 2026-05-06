# Plan — Hardening del cliente MCP

Origen: revisión de `lib/mcp-client.ts` (2026-05-06). 6 puntos pendientes.

## Contexto crítico

- SDK: `@modelcontextprotocol/sdk@1.29.0`.
- Runtime: Next.js 16 (App Router, server actions). Despliegue actual: Azure Container Apps (Dockerfile presente) → runtime persistente, **no** serverless de cold-start. Esto es relevante para el punto #1.
- Commit `ddbe72c` serializó `callTool` para evitar conflicto del transport en paralelo. El script `scripts/test-sdk-client.mjs --parallel` reproduce el bug. **No se puede paralelizar con `Promise.all` sobre un único `client`/`transport`** sin un cambio de diseño.
- Server action: `app/actions/evaluate.ts` invoca `evaluate()` por cada submit del formulario.

## Grafo de dependencias

```
                ┌── #3 mensaje "30s"           (aislado, trivial)
                │
   mcp-client ──┼── #4 URL termina en /mcp     (aislado, en getConfig/connect)
                │
                ├── #5 closeQuietly silencioso (aislado, logging)
                │
                ├── #2 paralelización ───────► requiere repro del bug y decidir
                │                               (a) 1 transport por call, o
                │                               (b) actualizar SDK, o
                │                               (c) mantener serial con timeout menor
                │
                ├── #6 retry transitorio ─────► depende de #2 (qué errores son transitorios)
                │
                └── #1 sesión por request ────► depende del modelo de despliegue;
                                                impacta a #6 (reconectar vs reusar)
```

Independientes entre sí: #3, #4, #5.
Acoplados: #2 → #6 → #1 (en ese orden de dependencia conceptual).

## Estrategia de slicing (vertical, no por capas)

Cada slice toca código + verificación end-to-end. Sin slices "solo refactor" o "solo tests".

### Fase 1 — Quick wins (slice A)
Puntos #3, #4, #5. Bajo riesgo, valor inmediato. Una sola tarea agrupada porque son cambios de <10 líneas cada uno y no se solapan.

### Checkpoint 1
Antes de seguir: `pnpm typecheck` + `pnpm lint` + smoke manual con `scripts/test-sdk-client.mjs` (serial). Confirmar que el flujo `/` sigue evaluando OK.

### Fase 2 — Reducir latencia (slice B)
Punto #2. Requiere primero **reproducir el bug original** con el script existente, leer el código del transport en `node_modules/@modelcontextprotocol/sdk/dist/.../streamableHttp.js`, y elegir entre:
  - **B1** Una sesión MCP por tool call concurrente (N transports paralelos por `evaluate()`). Mantiene SDK actual. Más conexiones HTTP pero corto-vivas.
  - **B2** Bump del SDK si una versión posterior arregla la concurrencia sobre un solo transport (verificar changelog).
  - **B3** Mantener serial pero bajar `TIMEOUT_PER_CALL_MS` y/o detectar tools rápidas vs lentas.

Decisión por escrito antes de implementar (en `tasks/decision-parallel.md`).

### Checkpoint 2
Smoke con input URL real (5 tools). Medir latencia antes/después. Confirmar que ningún tool se pisa.

### Fase 3 — Resiliencia (slice C)
Punto #6. Retry con backoff exponencial limitado (ej. máx. 1 reintento por tool, solo en errores transitorios: `ECONNRESET`, 5xx, `TimeoutError` no terminal). Sin retry en errores de validación Zod o `isError: true` del tool.

### Checkpoint 3
Test forzando un fallo transitorio (mock o tool con error inyectado). Confirmar que se reintenta una vez y luego falla limpio.

### Fase 4 — Reuso de sesión (slice D, opcional)
Punto #1. Solo si la fase 2 no eliminó el overhead percibido y si confirmamos runtime persistente. Implica:
  - Singleton de cliente MCP en módulo (lazy).
  - Health-check / reconexión si el transport muere.
  - Cuidado con HMR de Next dev (usar `globalThis.__mcpClient` pattern).

Si en métricas el `connect()` toma <100ms, esta fase **no se hace**. Marcar como descartada con justificación.

### Checkpoint 4
Si se implementa: prueba de carga ligera (10 evaluaciones consecutivas) verificando que solo hay 1 `connect()` en logs y que tras matar la sesión se recupera.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Paralelizar reintroduce el bug del transport | Reproducir primero con `--parallel`, decidir B1/B2/B3 con datos |
| Singleton de cliente filtra estado entre requests | No compartir `AbortSignal`; cada request crea su propio signal por call |
| Retry esconde errores reales | Loggear cada intento con `attempt: N` para visibilidad |
| Cambio de `MCP_URL` (hoy con/sin `/mcp`) rompe instalaciones existentes | Normalizar aceptando ambos formatos sin pedir cambio de env |

## Fuera de alcance

- Cambiar el contrato de `EvaluationResult`.
- Agregar caché de resultados (otro proyecto).
- Métricas/tracing (otro proyecto).
- Cambiar el flujo de `pickToolCalls`.
