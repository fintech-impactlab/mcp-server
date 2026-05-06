# Plan — Bugs de `full_evaluation` (confianza, reasons silenciosos, classifier laxo)

> Spec base: [SPEC.md](../SPEC.md), [SCORING.md](../SCORING.md).
> Plan paralelo: [tasks/plan-references.md](plan-references.md) (Phase 2 en curso). Este plan es **ortogonal** y compatible: extiende `Reason` agregando un `kind` discriminador, sin chocar con la extensión `legalRefs`.

## Contexto

Smoke real contra `https://www.fraccional.cl/` (fintech inmobiliaria chilena, real) reportó:

```jsonc
{
  "totalScore": 0,
  "verdict": "sin_senales_negativas",
  "confianza": 100,            // ← bug #1: 6/12 fuentes caídas, igual reporta 100
  "reasons": [],               // ← bug #2: silencio total en 5 etapas
  "tipoEntidad": "desconocido",// ← bug #3: fintech conocida, classifier no la cataloga
  "breakdown": [...]           // todas las etapas con reasons: [] y partialScore: 0
}
```

Diagnóstico de los 3 bugs (verificado leyendo el código en sesión previa):

1. **Confianza falsa.** [`full_evaluation/index.ts:141`](../mcp-server/src/tools/full_evaluation/index.ts#L141) calcula `computeConfidence(toolsAttempted, toolsSucceeded)` — mide si el handler de cada tool no tiró excepción. No mira `dataAvailable` por fuente. Una tool puede "succeeded" con 2 de 3 fuentes caídas. → confianza inflada.

2. **Silencio sin hits.** Cada tool construye `Facts` solo con campos cuando hay señal positiva o negativa (ej. [`check_blacklist/index.ts:95-108`](../mcp-server/src/tools/check_blacklist/index.ts#L95)). El motor [`scoring/engine.ts:26-39`](../mcp-server/src/scoring/engine.ts#L26) solo emite `Reason` cuando `rule.predicate(facts) === true`. Resultado: si las fuentes responden OK pero ninguna regla matchea, el output queda mudo. **El usuario no sabe qué se verificó.**

3. **Classifier laxo.** [`check_regulator_status/classifier.ts:104-115`](../mcp-server/src/tools/check_regulator_status/classifier.ts#L104) cae a `desconocido` cuando: no está en la lista hardcoded de bancos + RPSF responde "no_registrada" + giros SII vacíos (porque `loadSiiGiros` no está cableado en prod, deuda técnica conocida). Para Fraccional, RPSF respondió y no figura → la información "no fiscalizada por CMF" se pierde y el classifier devuelve `desconocido`.

## Outcome esperado

Después de aplicar este plan:
- Confianza refleja el estado real de las 12 fuentes externas consultadas.
- Toda fuente que respondió OK emite al menos un `Reason` informativo (`weight: 0, kind: "info"`) describiendo qué se verificó y qué se halló (o no se halló).
- Entidades sin matching obvio en el catálogo formal pero con RPSF respondiendo se clasifican como `no_fiscalizada` (no `desconocido`), con normativa genérica de protección al consumidor.
- Como bonus operativo: `loadSiiGiros` queda cableado desde `verify_chilean_entity` para inputs RUT, eliminando la deuda técnica que hacía que reglas `regulator.*` nunca dispararan.

## Decisiones de arquitectura

> **Decisión humana pendiente:** confirmar elección entre F3a (introducir `no_fiscalizada`) y F3b (caer a `prestamista_no_regulado`). Plan asume **F3a** por preservar neutralidad regulatoria del README.

1. **`Reason.kind`** discriminador: `"signal"` (default, lo que existe hoy) | `"info"` (nuevo, weight obligatorio = 0). Schema retro-compatible.
2. **`infoReason()` helper** en `scoring/info-reasons.ts` evita duplicar la construcción y garantiza consistencia (`ruleId: "info.<tool>.<aspect>_verified"`).
3. **Confianza basada en sources, no en handlers.** Un tool con todas las sources caídas debe contribuir 0 al numerador de confianza, aunque la tool no haya tirado excepción. Mantenemos `toolsAttempted/Succeeded` como telemetría interna en el log `tool.call`, pero no en el output del usuario.
4. **`no_fiscalizada` es ortogonal a `desconocido`.** Reservamos `desconocido` para "no se pudo clasificar (fuentes caídas)" y agregamos `no_fiscalizada` para "se clasificó: no figura en RPSF ni lista de bancos" — situación accionable diferente.
5. **No tocamos el motor de scoring.** Las info reasons no son `Rule`s — se concatenan al output después de `score()`. El engine sigue 100% determinístico y auditable. Tests de determinismo no se rompen.
6. **Compatibilidad con plan-references.md.** Una info reason puede llevar `legalRefs` opcional cuando aplique (ej. `info.blacklist.cmf_alertas_no_match` con `legalRefs: ["CMF-ALERTAS-PIF"]`). Los dos planes se complementan.

## Dependency graph

```
[Slice 0: Foundation]
    │ Schema Reason gana `kind`; helper infoReason()
    ▼
[Slice 1: Confianza] ⛳ CP-1
    │ computeConfidence en orquestador deriva de sources, no handlers
    ▼
[Slice 2: Info reasons en cada tool] ⛳ CP-2
    │ Slicing vertical por tool (cada una shippable independiente):
    │   2.1 check_blacklist
    │   2.2 check_whitelist
    │   2.3 analyze_domain
    │   2.4 check_dns_ownership
    │   2.5 verify_chilean_entity
    │   2.6 check_regulator_status
    │   2.7 analyze_business_model
    ▼
[Slice 3: no_fiscalizada] ⛳ CP-3
    │ EntityType + classifyEntity + mappings + matrices + tests
    ▼
[Slice 4: loadSiiGiros wiring] ⛳ CP-4
    │ Cablear en src/index.ts con handler de verify_chilean_entity
    ▼
[Slice 5: Docs] ⛳ CP-D
    │ SCORING.md, README, SPEC §3.2
    ▼
[Slice 6: Smoke fraccional.cl] ⛳ CP-Smoke
      Re-correr scripts/smoke-fraccional.mjs y validar los 4 outcomes (cierre)
```

**Vertical**: cada sub-slice de Slice 2 ships una tool emitiendo info reasons end-to-end con sus tests. Slice 3 ships una nueva clasificación end-to-end (classifier + mapping + tests + smoke).

## Checkpoints

| ID | Después de | Validación |
|----|------------|------------|
| **CP-1** | Slice 1 | Smoke contra prod con `https://www.fraccional.cl/` muestra `confianza ≈ 50` (no 100). Test unitario nuevo confirma cálculo. Suite verde. |
| **CP-2** | Slice 2.7 | Smoke con Fraccional muestra `reasons.length ≥ 5` (al menos 1 reason por etapa con fuente OK). Cada `breakdown[*].reasons` tiene contenido. Suite verde. |
| **CP-3** | Slice 3 | Fraccional clasifica como `no_fiscalizada` (no `desconocido`). `tools/call check_regulator_status` con un RPSF-respondió-pero-no-está retorna ese tipo. `get_applicable_regulation` devuelve normativa sensata para esa categoría. |
| **CP-4** | Slice 4 | Smoke con un RUT de fintech autorizada en RPSF muestra `regulator.rpsf_autorizada_y_giro_consistente` (+25) disparando — la regla zombie se activa por primera vez. |
| **CP-D** | Slice 5 | Docs alineados: SCORING.md menciona info reasons; README "Sistema de scoring" describe el `kind`; SPEC §3.2 actualizado. |
| **CP-Smoke** | Slice 6 | `node mcp-server/scripts/smoke-fraccional.mjs` corre verde y reproduce los 4 outcomes (confianza < 100, ≥1 reason por etapa con fuente OK, `tipoEntidad: "no_fiscalizada"`, `legalReferences[]` íntegro). Cierre del plan. |

---

## Slice 0 — Foundation

- **0.1** Extender `Reason` schema en `lib/schemas.ts`.
  - **AC:** schema acepta `kind: "signal" | "info"` (optional, default `"signal"`). Si `kind === "info"`, `weight` debe ser `0` (Zod refine). Backward-compatible: reasons existentes sin `kind` siguen pasando validación como `"signal"`.
  - **Verify:** `pnpm test -- schemas`. Test nuevo: reason con `kind: "info"` y `weight: -10` → falla parse.

- **0.2** Helper `infoReason()` en `mcp-server/src/scoring/info-reasons.ts`.
  - **AC:** función `infoReason(toolName, aspect, message, opts?)` que retorna `Reason` con `kind: "info", weight: 0, ruleId: "info.<toolName>.<aspect>"`. `opts` puede incluir `legalRefs`, `fundamento` (default: el `message`).
  - **Verify:** test unitario verifica shape y backward-compat (parser `Reason` lo acepta).

> ⛳ Sin checkpoint propio — habilitador.

---

## Slice 1 — Confianza basada en sources

- **1.1** Refactor `computeConfidence` en `full_evaluation/index.ts`.
  - **AC:** función nueva `computeConfianzaFromSources(sources: ReadonlyArray<Source>): number` retorna `Math.round((sources.filter(s => s.dataAvailable).length / sources.length) * 100)`. Si `sources.length === 0`, retorna `0`. La fuente `"orchestrator"` (fallback cuando no hay nada) cuenta como `dataAvailable: true`. El campo `toolsAttempted/Succeeded` se mantiene en el log `tool.call` (telemetría) pero no se expone al output.
  - **Verify:** unit tests:
    - Todas OK (12/12) → 100
    - Mitad caídas (6/12) → 50
    - Todas caídas → 0
    - Lista vacía → 0
  - Smoke contra prod con Fraccional: `confianza ≤ 60`.

> ⛳ **CP-1** — confianza no miente.

---

## Slice 2 — Info reasons por tool

> Vertical: cada sub-slice es una tool shippable. Tras el sub-slice, `full_evaluation` ya muestra info reasons para esa etapa (campos opcionales lo permiten).

Política sistémica: por cada source con `dataAvailable: true` que **no** produjo un hit/señal que dispare una regla del engine, la tool emite **una** info reason describiendo qué se verificó.

Ejemplo target:

```json
{
  "ruleId": "info.check_blacklist.cmf_alertas_no_match",
  "kind": "info",
  "weight": 0,
  "message": "Sin coincidencias en CMF Alertas Ciudadanas",
  "fundamento": "Se consultaron los 4 listados oficiales (Plataformas/Apps/Créditos/Otras). El input no figura en ninguno."
}
```

- **2.1** `check_blacklist`
  - **AC:** después de construir `hits[]`, por cada source en `["cmf-alertas", "phishtank", "urlhaus"]` que es `dataAvailable: true` y no aportó hit, append una info reason a `reasons[]` (después de las que vienen del `score()`).
  - **Verify:** test E2E con cmf-alertas OK + 0 hits → `reasons.length >= 1` con `kind: "info", weight: 0`. Suite existente verde.

- **2.2** `check_whitelist` — misma política para `cmf-rpsf`, `fintechile`.
- **2.3** `analyze_domain` — info por `whois`, `tls`, `redirects` cuando OK y la tool no produjo Rule hit relacionada.
- **2.4** `check_dns_ownership` — info por `rdap-nic-cl` o `whois`.
- **2.5** `verify_chilean_entity` — info por `sii`, `dequienes`.
- **2.6** `check_regulator_status` — info por `cmf-rpsf`, `fintechile`, `sii-giros`.
- **2.7** `analyze_business_model` — info por `deterministic-detectors` (siempre OK) cuando ninguno de los 4 detectores prendió, y por `bce-rates` cuando OK.

> ⛳ **CP-2** — Fraccional muestra reasons en todas las etapas con fuente OK.

---

## Slice 3 — `no_fiscalizada` entity type

- **3.1** Agregar `"no_fiscalizada"` a `EntityType` en [`check_regulator_status/classifier.ts`](../mcp-server/src/tools/check_regulator_status/classifier.ts).
  - **AC:** unión actualizada. Sigue compilando todo el resto.

- **3.2** Reordenar `classifyEntity()` para insertar la nueva rama antes del `desconocido`.
  - **AC:** cuando `rpsfEstado === "no_registrada"` y no clasifica por giros ni por nombre ni por lista de bancos, retornar `"no_fiscalizada"`. `desconocido` queda solo para casos donde RPSF cayó (`dataAvailable: false`) y no hay otra señal — es decir, "no clasificable por falta de información".
  - **Verify:** unit tests del classifier:
    - input vacío + RPSF respondió no_registrada → `no_fiscalizada` (no `desconocido`)
    - input vacío + RPSF cayó → `desconocido`
    - input con giro 6491 + RPSF no_registrada → `fintech` (no se altera)

- **3.3** Mapping en `cmf-norms-mapping.ts`.
  - **AC:** entrada `no_fiscalizada` que apunta a Ley 19.496, Ley 19.628, Ley 18.010 (genéricas de consumo + crédito + datos). NO incluye normas específicas CMF (NCG 502/503/504/514) — esa es la diferencia con `fintech`.
  - **Verify:** test que valida que las 10 EntityTypes (9 + `no_fiscalizada`) tienen entrada.

- **3.4** Default en [`regulation-matrix.ts`](../mcp-server/src/constants/regulation-matrix.ts).
  - **AC:** `no_fiscalizada` cae al default por situación (igual que `desconocido`). No requiere overrides específicos en este slice — se pueden agregar después si surge un caso.

- **3.5** Default en [`channels-matrix.ts`](../mcp-server/src/constants/channels-matrix.ts).
  - **AC:** `no_fiscalizada` cae al default. SERNAC siempre disponible, sin canales CMF salvo en situaciones donde el catálogo lo asigna por situación.

- **3.6** Tests + smoke.
  - **Verify:** `tools/call check_regulator_status arguments={"rutOrName":"FRACCIONAL"}` retorna `tipoEntidad: "no_fiscalizada"` y `normativasAplicables[]` no vacío con leyes genéricas.

> ⛳ **CP-3** — Fraccional clasifica accionablemente.

---

## Slice 4 — Cablear `loadSiiGiros` desde `verify_chilean_entity`

- **4.1** En `mcp-server/src/index.ts`, al construir `regulatorStatusTool`, inyectar:
  - **AC:** `loadSiiGiros: async (query) => { if (!isRut(query)) return []; const r = await verifyChileanEntityTool.handler({ rut: query }); return r.giros; }`. Loader robusto: si verify_chilean_entity tira o retorna sin giros, retornar `[]`.
  - **Verify:** smoke con un RUT real que tenga giros 6491 → `check_regulator_status` retorna `tipoEntidad: "fintech"` por giro y la regla `regulator.rpsf_autorizada_y_giro_consistente` puede dispararse cuando el RPSF lo confirma.

- **4.2** Test del wiring.
  - **AC:** test E2E con verify_chilean_entity stubbeado → giros llegan al classifier de regulator_status.

> ⛳ **CP-4** — reglas `regulator.*` salen del estado zombie.

---

## Slice 5 — Docs

- **5.1** SCORING.md (regenerado vía `pnpm scoring:docs`) — agregar nota: "Las tools también emiten `info reasons` (kind=info, weight=0) por cada fuente verificada sin señal — auditables igual que las reglas del engine."

- **5.2** README §"Sistema de scoring" — explicar el `kind` y dar ejemplo de info reason.

- **5.3** SPEC.md §3.2 — `Reason.kind` documentado.

- **5.4** HOW_TO_CONNECT.md §"Paso 5" — ejemplo de output con info reasons + cómo el cliente las puede filtrar para UI.

> ⛳ **CP-D** — docs alineados.

---

## Slice 6 — Smoke contra dominio real (cierre del plan)

Ejecutar `mcp-server/scripts/smoke-fraccional.mjs` (creado en plan-references) contra `https://www.fraccional.cl/` reproduce los 3 bugs **antes** del fix; tras CP-D debe verificar que los 4 outcomes esperados se cumplen.

- **6.1** Pre-fix baseline (opcional, evidencia para el changelog).
  - Ejecutar el smoke **antes** de empezar el plan y guardar el output como `tasks/evidence/smoke-fraccional-pre-fix.txt` (gitignore opcional). Documenta confianza 100, reasons silenciosos, tipoEntidad desconocido. Sirve como prueba de regresión.

- **6.2** Adaptar el smoke script para validar los 4 outcomes esperados.
  - **AC:** [`mcp-server/scripts/smoke-fraccional.mjs`](../mcp-server/scripts/smoke-fraccional.mjs) gana asserts adicionales:
    - `response.confianza < 100` (reflejo real de fuentes caídas).
    - `response.breakdown.every(b => b.reasons.length > 0)` para etapas con al menos una source `dataAvailable: true`.
    - `response.tipoEntidad === "no_fiscalizada"` (no `"desconocido"`).
    - `response.legalReferences.length > 0` y cada `cita.texto` aparece literal en su `localPath` (ya está implementado por el plan-references; mantener).
  - El script falla con exit code 1 si cualquier assert falla. Se queda como verificación de regresión repetible.
  - **Verify:** correr el script contra Fraccional tras CP-D; debe pasar todos los asserts y emitir `✔ smoke OK`.

- **6.3** Comparar pre/post-fix en el body del PR del plan.
  - **AC:** PR de cierre incluye el diff entre `smoke-fraccional-pre-fix.txt` y la salida actual, mostrando los 3 bugs corregidos en el output real.

> ⛳ **CP-Smoke** — fin del plan. Si los 4 asserts pasan, los 3 bugs reportados quedan cerrados con evidencia end-to-end.

---

## Verificación end-to-end (alternativa por curl al MCP desplegado)

Útil si querés validar contra prod en Azure Container Apps en lugar del smoke local.

```bash
SID=...   # initialize handshake
curl -X POST $MCP/mcp -H "mcp-session-id: $SID" ... -d '{
  "jsonrpc":"2.0","id":1,"method":"tools/call",
  "params":{"name":"full_evaluation","arguments":{"input":"https://www.fraccional.cl/"}}
}' | jq '{
  confianza: .confianza,                      # < 100 (reflejo real)
  tipoEntidad: .tipoEntidad,                  # no_fiscalizada
  totalReasons: (.reasons | length),          # >= 5
  signalReasons: ([.reasons[] | select(.kind == "signal")] | length),
  infoReasons:   ([.reasons[] | select(.kind == "info")]   | length)
}'
```

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|-----------|
| Info reasons inflan los outputs y vuelven más caro el cliente downstream (LLM, UI) | Medio | Cliente puede filtrar por `kind == "signal"` para UI compacta. Documentar en HOW_TO_CONNECT. |
| Cambio de `confianza` rompe consumidores que asumen rangos viejos | Bajo | El campo siempre fue `0..100` y semánticamente igual. Solo cambia cuán optimista era. Documentar en CHANGELOG. |
| `no_fiscalizada` se confunde con `desconocido` en clientes existentes | Medio | Slice 5 docs explícito sobre la diferencia. Tests del classifier cubren ambos casos. |
| Choque con plan-references.md cuando ambos modifican `Reason` | Bajo | Plan-references agrega `legalRefs?: string[]`; este plan agrega `kind?: "signal" \| "info"`. Campos ortogonales. Coordinar merge: orden no importa. |
| Wiring de `loadSiiGiros` provoca latencia adicional cuando el RUT no es regulado (verify_chilean_entity scrapea SII inútilmente) | Medio | Aceptable en este iteración; ya hay cache 24h. Si emerge problema, condicionar el call: solo si `tipoEntidad` candidato es ambiguo tras la primera pasada. |

## Preguntas pendientes (humano debe confirmar antes de Slice 3)

1. **F3a vs F3b**: introducir `no_fiscalizada` (recomendado, neutral) vs caer a `prestamista_no_regulado` (más agresivo). Plan asume F3a.
2. **Mapping de normas para `no_fiscalizada`**: Ley 19.496 + 19.628 + 18.010 (recomendado, conservador) o sumar Ley 21.521 art.5 (señal explícita "estaría obligado a registrarse en RPSF si ofrece servicios fintech"). Plan asume conservador.
