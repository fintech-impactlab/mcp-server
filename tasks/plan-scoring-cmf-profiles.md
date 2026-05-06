# Plan — Scoring con perfiles CMF / No-CMF y escala de niveles

> Origen: [`scoring_extension_chrome_v3.md`](../scoring_extension_chrome_v3.md). Convierte el simulador del XLSX en motor productivo del MCP.
> Spec actual: [`SPEC.md`](../SPEC.md), [`SCORING.md`](../SCORING.md).
> TODO: [`tasks/todo-scoring-cmf-profiles.md`](todo-scoring-cmf-profiles.md).

## Contexto

El XLSX introduce dos conceptos que el motor actual **no** tiene:

1. **Perfil del sitio.** Cada evaluación se clasifica `requiereCMF: true | false`. En `false` solo aplican reglas marcadas `appliesToNonCmf = true` (señales generales: phishing, SSL, dominio, SII, lenguaje vago). En `true` aplican las 28.
2. **Escala de niveles.** Reemplaza el verdict de 3 estados (`alto_riesgo | riesgo_medio | sin_senales_negativas`) por un nivel 1-5 (`Crítico | Riesgoso | Neutro | Confiable | Muy confiable`) con **umbrales distintos por perfil** (porque el rango de score posible cambia: CMF [-745, +115], No-CMF [-380, +15]).

El motor actual (`mcp-server/src/scoring/rules.ts` + `engine.ts`) ya es determinístico, tabular y testeado. La migración es aditiva: se extiende el shape de `Rule`, el motor toma un parámetro de perfil, y se agrega una tabla de niveles. **No** hay refactor del data flow; cambia el contrato de salida.

## Discrepancias detectadas (requieren decisión humana antes de codificar)

| Regla | Peso código actual | Peso XLSX | Δ |
|---|---:|---:|---:|
| `blacklist.cmf_plataformas_no_reguladas` | -50 | -70 | -20 |
| `blacklist.cmf_creditos_fraudulentos` | -50 | -70 | -20 |
| `blacklist.cmf_apps_creditos_no_reguladas` | -50 | -70 | -20 |
| `blacklist.cmf_otras_entidades_no_reguladas` | -50 | -70 | -20 |
| `whitelist.rpsf_autorizada` | +30 | +50 | +20 |
| `entity.sii_suspendido` | -30 | -20 | +10 |
| `entity.sii_sin_inicio` | -50 | -40 | +10 |
| `entity.antiguedad_lt6m` | -15 | -10 | +5 |

Las otras 20 reglas tienen peso idéntico.

**Implicación:** SCORING.md exige hoy `Pesos. Integer en [-50, +50]`. Adoptar el XLSX requiere relajar la cota a `[-70, +50]` (las positivas siguen ≤+50).

## Preguntas abiertas (bloquean Fase 1)

1. **¿Adoptar los pesos del XLSX o mantener los del código?** El XLSX fue calibrado por el equipo del lab para el simulador; el código tiene tests con los pesos actuales. Recomendación: adoptar XLSX (es la calibración más reciente + revisada por humanos), aceptar el churn de tests.
2. **¿`verdict` (3 estados) se reemplaza o convive con `nivel` (5)?** Reemplazar es breaking para clientes (web, extensión, futuros bots). Convivir 1 release y deprecar `verdict` en el siguiente. Recomendación: convivir.
3. **Fuente de `requiereCMF`.** Tres opciones: (a) derivado del `tipoEntidad` ya clasificado por `check_regulator_status/classifier.ts` (banco/fintech/cooperativa/etc. → `true`; `no_fiscalizada` → `false`; `desconocido` → ¿default?); (b) decidido por el orquestador LLM upstream; (c) input explícito del cliente. Recomendación: (a) con default `true` para `desconocido` (más seguro: tratar lo dudoso como si requiriera regulación) + override opcional vía input.
4. **Default cuando ambas fuentes (RPSF + SII) caen.** Si no se puede clasificar, ¿usar perfil CMF por seguridad o devolver `nivel: null` con `dataAvailable: false`? Recomendación: perfil CMF (conservador) + reason `info` que lo declare.

> **Acción:** resolver las 4 antes de empezar Fase 1. El plan asume las recomendaciones.

## Decisiones arquitectónicas (asumiendo recomendaciones)

- **Single source of truth:** `rules.ts` con `appliesToNonCmf: boolean` por regla. El XLSX queda como documento de referencia, no se importa en runtime.
- **Niveles** viven en `mcp-server/src/scoring/levels.ts` (nuevo): dos `LevelScale` ordenadas por umbral descendente. Lookup determinístico `score → nivel`.
- **`score()` toma `profile`** como segundo argumento (default `"cmf"` para retro-compat de tests). Filtra reglas con `if (profile === "no_cmf" && !rule.appliesToNonCmf) continue;`.
- **`full_evaluation`** decide perfil tras Etapa 3 (cuando `tipoEntidad` está disponible) y recalcula el score consolidado bajo ese perfil. Las etapas individuales siguen retornando score CMF (no saben aún el perfil); el ajuste final ocurre en el orquestador.
- **`SCORING.md`** se regenera con dos columnas nuevas (`Peso No-CMF aplica`, `Aporte No-CMF`) y una sección de tablas de niveles.

## Dependency graph

```
[F1: Catálogo y pesos]
    extiende Rule + reconcilia 9 pesos
    │
    ▼
[F2: Motor por perfil + niveles]
    score(facts, profile) + levels.ts
    │
    ▼
[F3: Clasificador requiereCMF]
    tipoEntidad → boolean
    │
    ▼
[F4: Orquestador full_evaluation]
    integra perfil + nivel en output
    │
    ▼
[F5: Documentación + cliente]
    SCORING.md, SPEC.md, web/extension
```

## Estrategia de slicing

Vertical por concepto. Cada slice deja el sistema en estado verde (tests pasan, build limpio). El cambio de pesos (T1.2) y la introducción del segundo perfil (T2.1) son cortes naturales con impacto en tests; cada uno es un slice propio.

## Tareas

### Fase 1 — Catálogo y pesos

#### T1.1 — Extender `Rule` con flag `appliesToNonCmf`

Agregar campo booleano a la interface `Rule` en `rules.ts` y poblarlo en las 28 reglas según la columna del XLSX (`True` = aplica a No-CMF). Las 11 reglas que NO aplican a No-CMF: las 4 de blacklist CMF + las 2 de regulator + las 3 de whitelist + 2 de business_model (`promesa_rentabilidad_irreal`, `estructura_referidos`).

**Aceptación:**
- [ ] `Rule` tiene `appliesToNonCmf: boolean` (no opcional, sin default).
- [ ] Las 28 reglas tienen el flag explícito y coincide con la columna del XLSX.
- [ ] Test nuevo `rules-non-cmf-flag.test.ts` valida los 28 valores contra una tabla embebida.

**Verificación:**
- [ ] `pnpm typecheck`
- [ ] `pnpm test -- --grep "rules"`

**Archivos:** `mcp-server/src/scoring/rules.ts`, `mcp-server/src/scoring/__tests__/rules-non-cmf-flag.test.ts` (nuevo).
**Tamaño:** S.

#### T1.2 — Reconciliar pesos con XLSX (9 reglas)

Aplicar los pesos del XLSX a las 9 reglas con discrepancia. Relajar la cota declarada (comentario en `rules.ts` + `SCORING.md` § Convenciones) de `[-50, +50]` a `[-70, +50]`. Actualizar tests afirmativos/negativos en `rules.test.ts` y cualquier golden de score que cambie.

**Aceptación:**
- [ ] Las 9 reglas tienen el peso del XLSX.
- [ ] Comentario de cota en `rules.ts` actualizado.
- [ ] Tests existentes pasan con los pesos nuevos (ajustar fixtures, no la regla).
- [ ] Test nuevo: total mín/máx CMF == -745 / +115 y No-CMF == -380 / +15 (acotando todas las reglas en la dirección correspondiente).

**Verificación:**
- [ ] `pnpm test`
- [ ] Inspección manual de cualquier fixture `__fixtures__/` que asuma score numérico.

**Archivos:** `mcp-server/src/scoring/rules.ts`, `mcp-server/src/scoring/__tests__/rules.test.ts`, fixtures de tools que asuman scores específicos (`mcp-server/src/tools/full_evaluation/index.test.ts` muy probable).
**Tamaño:** M.

### Checkpoint CP-A — Catálogo alineado

- [ ] `pnpm test` y `pnpm typecheck` verdes.
- [ ] Diff revisado por humano: confirma calibración XLSX.
- [ ] **No** seguir si hay dudas sobre pesos.

### Fase 2 — Motor por perfil + niveles

#### T2.1 — Engine acepta `profile`

Cambiar firma de `score(facts, rules?)` a `score(facts, opts?: { profile?: "cmf" | "no_cmf"; rules?: Rule[] })` con default `"cmf"`. Si `profile === "no_cmf"`, saltar reglas con `appliesToNonCmf === false`. Tests existentes siguen pasando (default mantiene comportamiento). Nuevo test: profile no-cmf produce subset de reasons.

**Aceptación:**
- [ ] Firma nueva, retro-compat por default.
- [ ] Test: con `profile="no_cmf"`, 11 reglas son ignoradas aunque sus facts sean `true`.
- [ ] Test: determinismo 1000-invocaciones también pasa para `profile="no_cmf"`.

**Verificación:** `pnpm test -- --grep "scoring"`.

**Archivos:** `mcp-server/src/scoring/engine.ts`, `mcp-server/src/scoring/__tests__/engine.test.ts`.
**Tamaño:** S.

#### T2.2 — `levels.ts` con dos escalas

Nuevo archivo `mcp-server/src/scoring/levels.ts` con:

```ts
type LevelId = 1 | 2 | 3 | 4 | 5;
type LevelLabel = "Crítico" | "Riesgoso" | "Neutro" | "Confiable" | "Muy confiable";
interface LevelEntry { id: LevelId; label: LevelLabel; minScore: number; }
const SCALE_CMF: readonly LevelEntry[];      // umbrales 40, 0, -25, -50, -9999
const SCALE_NO_CMF: readonly LevelEntry[];   // umbrales 15, 5, -10, -50, -9999
function levelFor(score: number, profile: "cmf"|"no_cmf"): LevelEntry;
```

**Aceptación:**
- [ ] Dos arrays ordenados desc por `minScore`, cubren todos los reales.
- [ ] `levelFor` retorna el primer entry cuyo `minScore <= score`.
- [ ] Tests de borde: score == umbral exacto cae en el nivel superior; score < -50 cae en `Crítico`; un test por umbral por escala (10 tests mínimo).

**Verificación:** `pnpm test -- --grep "levels"`.

**Archivos:** `mcp-server/src/scoring/levels.ts` (nuevo), `mcp-server/src/scoring/__tests__/levels.test.ts` (nuevo).
**Tamaño:** S.

### Checkpoint CP-B — Motor multi-perfil

- [ ] Tests pasan en ambos perfiles.
- [ ] Determinismo verificado para no-cmf.

### Fase 3 — Clasificador `requiereCMF`

#### T3.1 — Mapping `tipoEntidad → requiereCMF`

Agregar export `requiereCMF(tipoEntidad: EntityType): boolean` en `mcp-server/src/tools/check_regulator_status/classifier.ts`. Mapping:

| EntityType | requiereCMF |
|---|:---:|
| `banco`, `caja_compensacion`, `cooperativa`, `fintech`, `casa_cambio`, `emisor_tarjetas`, `ecommerce_credito`, `prestamista_no_regulado` | `true` |
| `no_fiscalizada` | `false` |
| `desconocido` | `true` (default conservador) |

**Aceptación:**
- [ ] Función pura, exhaustiva (switch que el compilador valida con `EntityType`).
- [ ] Test cubre los 10 casos.

**Verificación:** `pnpm test -- --grep "classifier"`.

**Archivos:** `mcp-server/src/tools/check_regulator_status/classifier.ts`, `mcp-server/src/tools/check_regulator_status/classifier.test.ts`.
**Tamaño:** XS.

### Fase 4 — Orquestador `full_evaluation`

#### T4.1 — Schema de salida con `requiereCMF` + `nivel`

Extender `Output` en `mcp-server/src/tools/full_evaluation/schema.ts` con:

```ts
requiereCMF: boolean;          // perfil aplicado al cálculo final
nivel: 1 | 2 | 3 | 4 | 5;
etiqueta: "Crítico" | "Riesgoso" | "Neutro" | "Confiable" | "Muy confiable";
escala: "cmf" | "no_cmf";
```

`verdict` se mantiene (pregunta abierta #2 — convivencia 1 release). Mapping verdict↔nivel: `Crítico|Riesgoso → alto_riesgo`, `Neutro → riesgo_medio`, `Confiable|Muy confiable → sin_senales_negativas`.

**Aceptación:**
- [ ] Campos nuevos requeridos en schema Zod.
- [ ] Mapping bidirecional documentado en comentario sobre `verdict`.

**Archivos:** `mcp-server/src/tools/full_evaluation/schema.ts`.
**Tamaño:** XS.

#### T4.2 — Recálculo de score consolidado por perfil

En `index.ts`:
1. Tras Etapa 3, derivar `requiereCMF` desde el `tipoEntidad` retornado por `check_regulator_status` (o default `true` si la etapa cayó).
2. Recalcular `totalScore` filtrando reasons cuyas `ruleId` pertenezcan a reglas con `appliesToNonCmf=false` cuando `requiereCMF=false`. (Alternativa más limpia: re-correr `score()` sobre Facts agregados con el profile correcto, pero hoy las etapas no acumulan Facts crudos — solo reasons. Filtrar por `ruleId` lookup contra `rules.ts`.)
3. Calcular `nivel = levelFor(totalScore, profile)`.
4. Mantener `verdict` derivado del `nivel` por el mapping.
5. Emitir `info` reason que declare el perfil aplicado y por qué (`tipoEntidad` o default).

**Aceptación:**
- [ ] Output tiene `requiereCMF`, `nivel`, `etiqueta`, `escala`, además del `verdict` legacy.
- [ ] Tests E2E con sitio fintech autorizado retornan `requiereCMF=true`, escala CMF.
- [ ] Tests E2E con sitio supermercado/no-fiscalizada retornan `requiereCMF=false`, escala No-CMF, score más alto que con escala CMF (por filtrado de penalizaciones inaplicables).
- [ ] Determinismo del orquestador (`citations-determinism.test.ts` análogo) cubre `nivel`.

**Verificación:** `pnpm test -- --grep "full_evaluation"`.

**Archivos:** `mcp-server/src/tools/full_evaluation/index.ts`, `index.test.ts`, `short-circuit.ts` (los corte-tempranos siguen funcionando: `alto_riesgo` ↔ `nivel ≤ 2`, `sin_senales_negativas` ↔ `nivel ≥ 4`).
**Tamaño:** M.

#### T4.3 — Ajuste de short-circuit

`shortCircuitAfterStage1` y `shortCircuitAfterStage3` retornan hoy `Verdict`. Migrar a retornar `{ nivel, etiqueta, reason }` y derivar verdict legacy en el caller. Las condiciones no cambian; solo el shape.

**Aceptación:**
- [ ] Tests existentes de short-circuit pasan con shape nuevo.
- [ ] No se introducen niveles intermedios nuevos.

**Archivos:** `mcp-server/src/tools/full_evaluation/short-circuit.ts`, `short-circuit.test.ts`.
**Tamaño:** S.

### Checkpoint CP-C — Orquestador alineado

- [ ] `pnpm test` verde end-to-end.
- [ ] Inspección manual: `full_evaluation` sobre 4 fixtures (banco, fintech sin RPSF, e-commerce sano, e-commerce malo) produce el `nivel` esperado.
- [ ] Revisión humana del shape de output antes de tocar consumidores.

### Fase 5 — Docs + clientes

#### T5.1 — Regenerar SCORING.md

Actualizar `mcp-server/scripts/scoring-docs.mjs` para:
- Agregar columna `Aplica No-CMF` al catálogo.
- Agregar dos secciones nuevas: "Escala CMF" y "Escala No-CMF" con la tabla de `levels.ts`.
- Recalcular sumatorias por categoría diferenciando CMF / No-CMF (mín / máx posibles).

**Aceptación:**
- [ ] `pnpm scoring:docs` regenera `SCORING.md` sin diff manual.
- [ ] Tabla refleja los 28 valores de `appliesToNonCmf`.
- [ ] Sección de niveles cita los umbrales por escala.

**Archivos:** `mcp-server/scripts/scoring-docs.mjs`, `SCORING.md` (regenerado).
**Tamaño:** S.

#### T5.2 — Actualizar SPEC.md

Tocar §2 (objective: mencionar dos escalas), §3.2 (BaseToolResponse: nuevos campos), §3.5 (consumer contract: clientes deben renderizar `nivel`/`etiqueta`, no derivar de `verdict`).

**Archivos:** `SPEC.md`.
**Tamaño:** XS.

#### T5.3 — Cliente web

`web/` consume hoy `verdict`. Migrar UI a `nivel` (1-5) + `etiqueta` con semáforo de 5 colores. Mantener fallback a `verdict` durante el ciclo de deprecación.

**Aceptación:**
- [ ] UI muestra nivel + etiqueta + score.
- [ ] Si el MCP retorna sin `nivel` (rollback), cae a `verdict`.
- [ ] Test snapshot del componente actualizado.

**Archivos:** `web/app/**/*.tsx` (componentes de resultado), `web/lib/mcp-client.ts` o equivalente.
**Tamaño:** M.

#### T5.4 — Extensión Chrome (opcional, fuera de Cluster B)

`chrome-extension/popup/` y `content/` consumen el mismo output. Mismo cambio que web. **No se ejecuta en este plan**, queda como tarea downstream registrada.

### Checkpoint Final

- [ ] `pnpm typecheck` y `pnpm test` verdes.
- [ ] `pnpm scoring:docs` regenera sin diff.
- [ ] Web demo muestra el nivel correcto para los 4 sitios canónicos.
- [ ] Revisión humana antes de merge a `main`.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Cambio de pesos rompe verdicts en tests E2E del orquestador | Alto | T1.2 es slice propio con CP-A obligatorio; revisar todos los goldens en un solo PR. |
| Clientes externos (web, extensión) leen `verdict` y no se actualizan a tiempo | Medio | Mantener `verdict` durante 1 ciclo (decisión #2). Anunciar deprecación en CHANGELOG. |
| `requiereCMF=true` por default en `desconocido` produce false-positives en supermercados con RPSF caído | Medio | Reason `info` declarando el default + observabilidad: contar eventos `tool.call` con `requiereCMF.source = "default_unknown"`. |
| Pesos del XLSX no reflejan revisión legal (calibración interna del lab) | Alto si hay regulador mirando | Pregunta abierta #1 antes de Fase 1; documentar en ADR-002 si se adoptan. |
| `appliesToNonCmf` mal asignado en una de las 28 reglas (typo) | Medio | T1.1 incluye test que valida los 28 valores contra tabla embebida (espejo del XLSX). |

## Definición de hecho

- Las 28 reglas calibradas según XLSX y con flag `appliesToNonCmf`.
- `score()` acepta perfil; `levelFor()` retorna nivel determinístico.
- `full_evaluation` retorna `requiereCMF`, `nivel`, `etiqueta`, `escala` además del `verdict` legacy.
- Tests cubren: cada regla afirmativa+negativa, ambos perfiles, los 10 cortes de nivel, determinismo 1000x.
- `SCORING.md` regenerado refleja perfiles + niveles.
- Web demo renderiza nivel.
- ADR-002 (si aplica) registra la calibración adoptada.
