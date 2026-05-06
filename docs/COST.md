# Costo estimado — `smart_evaluation`

`smart_evaluation` es la única tool del MCP que llama a la API de Claude
(Haiku 4.5). El resto del catálogo es 100 % determinístico y gratis. Esta
nota da una estimación de costo por invocación basada en mediciones de
clasificación + tool-use loop.

## Precio Haiku 4.5 (referencia Anthropic, ene 2026)

- Input: ~$0.25 / 1M tokens
- Output: ~$1.25 / 1M tokens

## Costo por invocación

### Path B1 (input simple — solo clasifica)

Una sola llamada a Claude con el prompt v1.

| Componente | Tokens estimados | USD |
|-----------|------------------|-----|
| System prompt (`classify-v1`) | ~500 in | $0.000125 |
| User input (URL/RUT/nombre) | ~30 in | $0.0000075 |
| Output JSON | ~100 out | $0.000125 |
| **Total por request** | ~530 in / 100 out | **~$0.00026** |

Con 1000 requests/día → **~$0.26/día** o **~$8/mes**.

### Path B3 (input ambiguo — escala a tool-use)

Loop con N iteraciones (cap 5). Cada iter:
- Re-envía contexto acumulado (input + tool_results de iters previas).
- Output es un nuevo `tool_use` o `end_turn`.

| Iter | Input acum | Output | USD/iter |
|------|------------|--------|----------|
| 1    | ~700 in    | ~150   | ~$0.000363 |
| 2    | ~1,500 in  | ~150   | ~$0.000563 |
| 3    | ~2,500 in  | ~150   | ~$0.000813 |
| 4    | ~3,500 in  | ~150   | ~$0.001063 |
| 5    | ~4,500 in  | ~200   | ~$0.001375 |
| **Total 5 iters** | | | **~$0.0042** |

**Cap fuerte:** `maxTotalTokens: 20_000` corta antes de gastar más de
~$0.025 por request. `maxIters: 5` da otra capa de seguridad.

## Proyección

| Volumen mensual | B1 only ($) | 80/20 split B1/B3 ($) |
|-----------------|-------------|----------------------|
| 10k requests    | ~$2.6       | ~$10                 |
| 100k requests   | ~$26        | ~$100                |
| 1M requests     | ~$260       | ~$1,000              |

## Cómo medir costo real en prod

```bash
# Tokens totales de las últimas 1000 invocaciones de smart_evaluation
az monitor log-analytics query --workspace <log-fintech-dev-id> \
  --analytics-query "
    ContainerAppConsoleLogs_CL
    | where Log_s contains 'claude.call'
    | extend log = parse_json(Log_s)
    | where log.toolName == 'smart_evaluation'
    | summarize totalIn=sum(toint(log.inputTokens)),
                totalOut=sum(toint(log.outputTokens)),
                count=count()
      by bin(TimeGenerated, 1d)
    | take 30"
```

Convertir a USD: `totalIn × 0.25/1M + totalOut × 1.25/1M`.

## Triggers para revisión

- Si el costo mensual supera $50 sin tráfico que lo justifique → revisar
  el ratio B1/B3 y posiblemente endurecer cuándo se considera "ambiguo".
- Si el output tokens promedio sube > 30 % entre revisiones del prompt →
  revisar el system prompt (puede haberse añadido verbosidad).
