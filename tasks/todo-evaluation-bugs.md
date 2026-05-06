# TODO — Bugs de `full_evaluation`

> Spec: [tasks/plan-evaluation-bugs.md](plan-evaluation-bugs.md). Plan paralelo: [tasks/plan-references.md](plan-references.md) (ortogonal).
> Convención: cada tarea tiene **AC** y **Verify**. No marcar `[x]` sin pasar Verify.

---

## Slice 0 — Foundation

- [ ] **0.1** Extender `Reason` schema en `mcp-server/src/lib/schemas.ts` con `kind: "signal" | "info"` opcional + Zod refine que exige `weight === 0` cuando `kind === "info"`.
  - **Verify:** `pnpm test -- schemas`. Reasons existentes (sin `kind`) siguen pasando como `signal`. Reason con `kind: "info"` y `weight: -10` → falla parse.

- [ ] **0.2** Helper `infoReason()` en `mcp-server/src/scoring/info-reasons.ts`.
  - **AC:** `infoReason(toolName, aspect, message, opts?)` → `Reason { kind: "info", weight: 0, ruleId: "info.<toolName>.<aspect>", ... }`.
  - **Verify:** unit tests + parser-back-compat.

---

## Slice 1 — Confianza desde sources ⛳ CP-1

- [ ] **1.1** Refactor `computeConfidence` → `computeConfianzaFromSources(sources)`.
  - **AC:** `Math.round(dataAvailableCount / sources.length * 100)`. Lista vacía → 0. La fuente sintética `"orchestrator"` cuenta como OK. `toolsAttempted/Succeeded` se mantiene en log `tool.call` como telemetría interna.
  - **Verify:** unit tests (todas OK / mitad caídas / todas caídas / vacío) + smoke contra prod con Fraccional → `confianza ≤ 60`.

> ⛳ **CP-1** — confianza no miente.

---

## Slice 2 — Info reasons por tool ⛳ CP-2

> Política sistémica: cada source con `dataAvailable: true` que no produjo un Rule hit emite UNA info reason describiendo lo verificado.

- [ ] **2.1** `check_blacklist` emite info por cmf-alertas / phishtank / urlhaus cuando OK + sin hit.
  - **Verify:** test E2E con cmf-alertas OK + 0 hits → `reasons.length ≥ 1` con `kind: "info"`.

- [ ] **2.2** `check_whitelist` (cmf-rpsf, fintechile).
- [ ] **2.3** `analyze_domain` (whois, tls, redirects).
- [ ] **2.4** `check_dns_ownership` (rdap-nic-cl o whois).
- [ ] **2.5** `verify_chilean_entity` (sii, dequienes).
- [ ] **2.6** `check_regulator_status` (cmf-rpsf, fintechile, sii-giros).
- [ ] **2.7** `analyze_business_model` (deterministic-detectors, bce-rates).

> ⛳ **CP-2** — Smoke con Fraccional muestra `reasons.length ≥ 5`, cada `breakdown[*].reasons` tiene contenido.

---

## Slice 3 — `no_fiscalizada` entity type ⛳ CP-3

- [ ] **3.1** Agregar `"no_fiscalizada"` a `EntityType` en `check_regulator_status/classifier.ts`.
- [ ] **3.2** Reordenar `classifyEntity()`: si `rpsfEstado === "no_registrada"` y no clasifica por giros/nombre/lista de bancos → `"no_fiscalizada"`. `desconocido` queda solo cuando RPSF cayó.
  - **Verify:** unit tests cubren los 3 casos clave (no_fiscalizada / desconocido / fintech).
- [ ] **3.3** Mapping en `cmf-norms-mapping.ts` para `no_fiscalizada` (Ley 19.496 + 19.628 + 18.010).
- [ ] **3.4** Default en `regulation-matrix.ts`.
- [ ] **3.5** Default en `channels-matrix.ts`.
- [ ] **3.6** Smoke: Fraccional → `tipoEntidad: "no_fiscalizada"` + normativas genéricas.

> ⛳ **CP-3** — Fraccional clasifica accionablemente.

---

## Slice 4 — Cablear `loadSiiGiros` ⛳ CP-4

- [ ] **4.1** En `mcp-server/src/index.ts`, inyectar `loadSiiGiros` desde el handler de `verify_chilean_entity` cuando query es RUT.
  - **AC:** loader robusto: si verify_chilean_entity tira o sin giros → `[]`.
- [ ] **4.2** Test del wiring + smoke con un RUT real fintech autorizada.

> ⛳ **CP-4** — `regulator.rpsf_autorizada_y_giro_consistente` (+25) sale del estado zombie.

---

## Slice 5 — Docs ⛳ CP-D

- [ ] **5.1** SCORING.md regenerado con nota sobre info reasons.
- [ ] **5.2** README §"Sistema de scoring" describe `kind` con ejemplo.
- [ ] **5.3** SPEC.md §3.2 documenta `Reason.kind`.
- [ ] **5.4** HOW_TO_CONNECT.md §"Paso 5" muestra ejemplo con info reasons + tip de filtrado por `kind`.
