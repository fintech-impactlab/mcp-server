# Plan — MCP Tools (Cluster B)

## Contexto

El [README.md](../README.md) describe la visión completa del MCP: **11 tools granulares + 1 tool de orquestación** (`full_evaluation`), organizadas en 5 etapas, con scoring determinístico y fuentes oficiales chilenas. Sin embargo, el plan de infra ([tasks/plan.md](plan.md) + [tasks/todo.md](todo.md)) explícitamente declara out-of-scope la implementación de tools y solo entrega el package skeleton con `/health` y un endpoint MCP vacío (Slice 5.1 de infra).

Este plan cubre el **gap** entre la infra y la visión del README: implementar las tools sobre el server MCP que la infra deploya. Es independiente del avance de infra para desarrollo local; solo se acopla al deploy en Slice 5.5 de infra (Container Apps con ingress interno).

**Outcome esperado:** un MCP funcional con las 11 tools + orquestador, deployable en `ca-mcp-<env>`, consumible por cualquier cliente MCP (Claude Desktop, web demo, futura extensión de navegador).

---

## Alcance

- 11 tools del README (5 etapas).
- 1 tool de orquestación (`full_evaluation`).
- Patrón compartido reutilizable: estructura de tools, errores tipados, logging hasheado, cache, schemas Zod.
- Motor de scoring determinístico + `SCORING.md` (cumple promesa del README, sección "Sistema de scoring").
- Cobertura de tests obligatoria por regla de scoring y por parser de fuente externa.

## Stack confirmado

Detalle completo en [SPEC.md § 2](../SPEC.md). Resumen:

- Runtime: **Node 22** + TypeScript 5.6 estricto (`strict: true` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch`).
- Package manager: **pnpm 10.33.0** vía Corepack.
- MCP: `@modelcontextprotocol/sdk` 1.29.0 sobre Streamable HTTP stateless (bootstrap ya entregado en `mcp-server/src/index.ts` por infra Slice 5.1).
- HTTP server: Express 4.21.2.
- HTTP client outbound: `undici` (a sumar en Slice 0).
- Validación: Zod en todos los bordes.
- Tests: **Node test runner nativo** (`node --test --test-reporter=spec`). Reevaluar a Vitest al cierre de Slice 1 si la cobertura experimental no alcanza.
- Cache: Storage Blob (`cache-cmf`, `cache-rpsf`, `audit` ya provistos por infra Slice 3.2) vía UAI `uai-mcp-<env>`. Tasas BCE viven con prefijo `rates:` en `audit`.
- Cron jobs (refresh CMF/RPSF/FinteChile): Container Apps Jobs separados con scale-to-zero (sumar al plan de infra cuando llegue Slice 4).
- Secretos: Key Vault con `secretRef`, vía UAI `uai-mcp-<env>` (provisto por infra Slice 7.1).
- Logging hasheado: helper `hashInput` (alineado con infra Slice 7.3).
- Telemetría: **logs JSON a stdout** → Container Apps → Log Analytics workspace `log-fintech-${env}`. Evento canónico `tool.call`, ver [SPEC § 6.4](../SPEC.md). App Insights queda diferido.

---

## Dependency graph

```
[Slice 0: Patrón compartido]
    │ tools/<name>/, errores tipados, hashInput, cache,
    │ schemas Zod base, test harness, registry
    ▼
[Slice 1: Motor de scoring]
    │ tabla de reglas → función score(facts) → SCORING.md
    ▼
[Slice 2: get_market_reference_rates]   ← primera tool, smoke del patrón
    │ API BDE BCE (REST JSON, sin scraping)
    │ habilita Slice 10 (analyze_business_model)
    ▼
[Slice 3: explain_law_simple]   ┐ paralelos entre sí
    │ API BCN Ley Fácil          │
[Slice 4: check_blacklist]       │ ya validado el patrón
    │ XLSX CMF + PhishTank +     │ se pueden tomar en distinto orden
    │ URLhaus + Safe Browsing    │
    ▼                            ▼
[Slice 5: check_whitelist]
    │ scraping CMF RPSF + FinteChile (1 req/s)
    │ habilita Slice 9
    ▼
[Slice 6: analyze_domain]
    │ WHOIS + SSL + redirects (sin dependencias)
    ▼
[Slice 7: check_dns_ownership]
    │ NIC Chile + WHOIS internacional
    ▼
[Slice 8: verify_chilean_entity]
    │ scraping SII + dequienes.cl
    ▼
[Slice 9: check_regulator_status]   ← reusa parsers de Slice 5
    │ + clasificador tipo de entidad
    ▼
[Slice 10: analyze_business_model] ⚠️   ← depende de Slice 2
    │ reglas determinísticas + ref a tasas BCE
    ▼
[Slice 11: get_applicable_regulation]
    │ catálogos en código (leyes + normativas CMF)
    ▼
[Slice 12: get_official_complaint_channels]
    │ catálogo de canales por tipo_entidad+situacion
    ▼
[Slice 13: full_evaluation]
    │ orquestación determinística con corte temprano
    │
    ▼
[CHECKPOINT FINAL] → MCP completo, demo end-to-end
```

## Estrategia de slicing

**Vertical, una tool a la vez.** Cada slice de tool entrega: schema Zod + cliente de fuente + cache + reglas de scoring + registro en server MCP + tests con fixture + trazas. La primera tool (Slice 2) establece el patrón; las siguientes lo reusan.

**Foundations primero (Slices 0-1).** Sin patrón compartido y sin motor de scoring, cada tool reinventa la rueda. Estos dos slices son atómicos pero indispensables.

**Paralelización:** después de Slice 2, las tools de Etapa 2-3 (Slices 3-8) son mayormente independientes entre sí y pueden tomarse en cualquier orden o en paralelo (con distintas personas, no por la misma persona).

---

## Checkpoints (revisión obligatoria)

| Checkpoint | Cuándo | Qué validar |
|---|---|---|
| **CP-A** | Después de Slice 1 | Patrón compartido + scoring listos. Todo test del motor de scoring verde. `SCORING.md` publicado. Sin esto, las tools posteriores no son auditables. |
| **CP-B** | Después de Slice 2 | Primera tool end-to-end. `tools/list` MCP la expone, `tools/call` retorna respuesta válida con schema Zod. Logs JSON `tool.call` visibles en Log Analytics con input hasheado. Patrón confirmado para reuso. |
| **CP-C** | Después de Slice 5 | Etapa 1 completa (blacklist + whitelist). Caso de uso 2 del README (extensión de navegador, una sola consulta) ya viable. |
| **CP-D** | Después de Slice 9 | Etapas 1-2-3 completas (8 tools). Caso de uso 5 del README (verificación periodística) viable end-to-end manualmente componiendo tools. |
| **CP-E** | Después de Slice 13 | 11 tools + `full_evaluation`. Casos de uso 1, 4, 6 del README viables. Handover a equipo de cliente Next.js / extensión / app SMS. |

---

## Riesgos identificados

- **Fragilidad de scraping.** CMF Alertas (XLSX), CMF RPSF, SII Situación Tributaria, dequienes.cl, NIC Chile, FinteChile, SERNAC no exponen API REST. Cualquier cambio del HTML rompe el parser silenciosamente. Mitigación: fixtures congelados + tests por parser + alerta de Log Analytics (Kusto query schedulada) cuando un parser empieza a retornar 0 resultados sostenidamente.
- **Rate limits de fuentes públicas.** Política del MCP es 1 req/s mínimo a fuentes scrapeadas. Mitigación: queue interno por fuente, cache Blob agresivo (TTL por tipo: tasas BCE 24h, leyes BCN 7d, RPSF 24h, CMF Alertas 24h con job programado), backoff exponencial.
- **API keys con cuotas.** PhishTank, Google Safe Browsing tienen cuotas gratuitas limitadas. Mitigación: cache + degradación graceful (si la fuente está caída/cuota, el resto del verdict sigue funcionando con `data_unavailable: true` por fuente).
- **Drift legal/regulatorio.** Catálogos de leyes, normativas CMF y canales de denuncia en `Slice 11-12` son código estático. Si cambia una ley o entra en vigencia una nueva (Ley 21.719 el 1 dic 2026), el catálogo queda desactualizado. Mitigación: cada entrada incluye `vigenciaDesde` y `vigenciaHasta`; CI corre check trimestral contra BCN.
- **Determinismo del scoring.** Tentación de meter LLM "para casos difíciles". Política CLAUDE.md es clara: nada de LLM en scoring. Mitigación: revisión obligatoria en cada PR de cualquier rama nueva del motor de scoring.
- **PII en logs.** RUTs, emails, URLs consultadas son sensibles (Ley 21.719 / ARCO+). Mitigación: helper `hashInput` obligatorio en todo log de tool input; lint rule que bloquee `console.log` con argumentos no marcados como ya hasheados.

---

## Out of scope (este plan no cubre)

- Infra Azure ([tasks/plan.md](plan.md) cubre).
- Cliente Next.js demo (Slice 6 de infra solo levanta skeleton; UI real es plan posterior).
- Extensión de navegador, app SMS, bot WhatsApp (post-lab según roadmap del README).
- Borradores de denuncia (deliberadamente fuera del MCP, función del cliente — sección "Lo que el MCP NO hace").
- Envío automatizado a CMF/SERNAC (visión a mediano plazo, requiere consentimiento explícito).
- Persistencia individual de consultas (ARCO+, decisión deliberada del README).
- Custom domain / cert (`*.azurecontainerapps.io` provisto por Azure).

---

## Verificación end-to-end (al cierre del plan)

```bash
# 1. Las 11 tools + 1 orquestador expuestas
curl -fsSL https://<ca-mcp-internal>/mcp/tools/list | jq '.tools | length'
# Esperado: 12

# 2. Cada tool retorna schema Zod-válido en una invocación de fixture
npm test -w mcp-server
# Esperado: 100% verde, cobertura motor de scoring 100%

# 3. full_evaluation con corte temprano
curl -fsSL -X POST https://<ca-mcp-internal>/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name":"full_evaluation","arguments":{"input":"<dominio-en-blacklist-fixture>"}}' \
  | jq '.score, .reasons, .stoppedAt'
# Esperado: score muy negativo, razón "blacklist hit", stoppedAt: "Etapa 1"

# 4. Logs `tool.call` en Log Analytics con input hasheado
az monitor log-analytics query --workspace <log-fintech-${env}-id> \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'ca-mcp-fintech-${env}' | extend log = parse_json(Log_s) | where log.event == 'tool.call' | project log.inputHash, log.toolName, log.clientId | take 10"
# Esperado: log.inputHash es hash de 8 hex, nunca el RUT/URL raw

# 5. SCORING.md existe y cubre todas las reglas
test -f SCORING.md && grep -c "^## " SCORING.md
# Esperado: archivo existe; al menos una sección por categoría de regla

# 6. Sin secretos en repo
git log --all -p | grep -iE "(api[_-]?key|secret|password|connection.?string)" | grep -v "example\|placeholder" || echo "OK"
```

## Próximo paso

Trabajar [tasks/todo-tools.md](todo-tools.md) slice por slice. No avanzar al siguiente slice sin pasar la verificación del actual. Mantener este plan y el de infra independientes; ambos convergen en el deploy de `ca-mcp-<env>`.
