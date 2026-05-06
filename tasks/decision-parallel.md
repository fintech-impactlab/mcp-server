# Decisión — Paralelización de tools MCP

Fecha: 2026-05-06
Contexto: Plan T2 / T3.

## Hipótesis previa

El commit `ddbe72c fix(mcp-client): serializar callTool para evitar conflicto de transport` indicaba que `Promise.all` sobre un único `client`/`transport` rompía algo. El plan original consideraba 3 opciones (B1 transport-por-call, B2 bump SDK, B3 mantener serial).

## Reproducción

Con `@modelcontextprotocol/sdk@1.29.0`, contra `ca-mcp-fintech-dev` en Azure Container Apps:

### `scripts/test-sdk-client.mjs --parallel` (2 tools, example.com)
- Paralelo OK. Sin error.

### `scripts/test-parallel-real.mjs https://example.com` (6 tools — la batería real para input URL)
- Serial: 1977ms, 6/6 OK
- Paralelo: 649ms, 6/6 OK
- Speedup 3.05x

### `scripts/test-parallel-real.mjs https://www.bancochile.cl` (5 corridas consecutivas)

| Run | Serial (ms) | Parallel (ms) | Speedup | Errores |
|---|---|---|---|---|
| 1 | 2600 | 811 | 3.21x | 0 |
| 2 | 1874 | 854 | 2.19x | 0 |
| 3 | 2350 | 1007 | 2.33x | 0 |
| 4 | 2115 | 938 | 2.25x | 0 |
| 5 | 2300 | 919 | 2.50x | 0 |

**Latencia paralelo p50 ≈ 919ms vs serial p50 ≈ 2300ms.** Speedup sostenido 2.2–3.2x.

## Conclusión

El bug histórico **no se reproduce** en SDK 1.29.0 con la batería de tools reales del proyecto, ni con tools livianas. No se encontraron notas de concurrencia/race en el código del transport. Hipótesis: el bug era específico de una versión anterior del SDK o de un shape de `callTool` previo.

## Decisión

**Opción elegida: B (paralelo sobre la misma sesión)** — variante más simple, sin abrir N transports.

Implementación:
- Reemplazar el `for` secuencial por `Promise.allSettled(calls.map(...))`.
- Cada call mantiene su propio `AbortSignal.timeout(TIMEOUT_PER_CALL_MS)`.
- Mismo manejo de errores parciales (outcomes con `ok: false` por tool).

## Riesgo residual y mitigación

- Si en producción aparece flake bajo carga real (workloads que el smoke no cubrió), la migración a B1 (un transport por call) es local a `evaluate()`, sin cambio de contrato.
- Mantener el script `scripts/test-parallel-real.mjs` como regresión.

## Métricas a capturar tras T3

- `durationMs` en `web.evaluate` antes/después con un input URL real en logs de Container Apps.
- Tasa de errores por tool (debería mantenerse ≈ 0 fuera de fallos legítimos).
