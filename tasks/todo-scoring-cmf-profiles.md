# TODO — Scoring con perfiles CMF / No-CMF

> Plan: [`tasks/plan-scoring-cmf-profiles.md`](plan-scoring-cmf-profiles.md). Origen: [`scoring_extension_chrome_v3.md`](../scoring_extension_chrome_v3.md).

## Bloqueos previos a Fase 1 (decisión humana)

- [ ] **D1** — Adoptar pesos XLSX (recomendado) o mantener pesos código actual. Afecta 9 reglas.
- [ ] **D2** — `verdict` legacy convive con `nivel` 1 release (recomendado) o se reemplaza ya.
- [ ] **D3** — `requiereCMF` se deriva de `tipoEntidad` (recomendado, default `true` en `desconocido`) o llega como input.
- [ ] **D4** — Default cuando RPSF + SII caen: perfil CMF (recomendado) o `nivel: null`.

---

## Fase 1 — Catálogo y pesos

- [ ] **T1.1** — Extender `Rule` con `appliesToNonCmf: boolean`; poblar 28 reglas.
  - [ ] `mcp-server/src/scoring/rules.ts`
  - [ ] `mcp-server/src/scoring/__tests__/rules-non-cmf-flag.test.ts`
- [ ] **T1.2** — Reconciliar 9 pesos contra XLSX; relajar cota a `[-70, +50]`.
  - [ ] `mcp-server/src/scoring/rules.ts`
  - [ ] `mcp-server/src/scoring/__tests__/rules.test.ts`
  - [ ] Goldens de `mcp-server/src/tools/full_evaluation/index.test.ts`

### CP-A
- [ ] `pnpm typecheck` y `pnpm test` verdes.
- [ ] Diff revisado por humano.

---

## Fase 2 — Motor por perfil + niveles

- [ ] **T2.1** — `score(facts, { profile })` filtra por `appliesToNonCmf`.
  - [ ] `mcp-server/src/scoring/engine.ts`
  - [ ] `mcp-server/src/scoring/__tests__/engine.test.ts`
- [ ] **T2.2** — `levels.ts` con dos escalas y `levelFor(score, profile)`.
  - [ ] `mcp-server/src/scoring/levels.ts` (nuevo)
  - [ ] `mcp-server/src/scoring/__tests__/levels.test.ts` (nuevo)

### CP-B
- [ ] Tests pasan en ambos perfiles, determinismo verificado.

---

## Fase 3 — Clasificador `requiereCMF`

- [ ] **T3.1** — Mapping `EntityType → boolean`.
  - [ ] `mcp-server/src/tools/check_regulator_status/classifier.ts`
  - [ ] `mcp-server/src/tools/check_regulator_status/classifier.test.ts`

---

## Fase 4 — Orquestador `full_evaluation`

- [ ] **T4.1** — Schema con `requiereCMF`, `nivel`, `etiqueta`, `escala`.
  - [ ] `mcp-server/src/tools/full_evaluation/schema.ts`
- [ ] **T4.2** — Recálculo de score consolidado por perfil.
  - [ ] `mcp-server/src/tools/full_evaluation/index.ts`
  - [ ] `mcp-server/src/tools/full_evaluation/index.test.ts`
- [ ] **T4.3** — Short-circuit retorna `{ nivel, etiqueta, reason }`.
  - [ ] `mcp-server/src/tools/full_evaluation/short-circuit.ts`
  - [ ] `mcp-server/src/tools/full_evaluation/short-circuit.test.ts`

### CP-C
- [ ] `pnpm test` verde end-to-end.
- [ ] 4 fixtures (banco / fintech sin RPSF / e-commerce sano / e-commerce malo) producen el nivel esperado.
- [ ] Revisión humana del output antes de tocar consumidores.

---

## Fase 5 — Docs + clientes

- [ ] **T5.1** — Regenerar `SCORING.md` con perfiles + niveles.
  - [ ] `mcp-server/scripts/scoring-docs.mjs`
  - [ ] `SCORING.md`
- [ ] **T5.2** — Actualizar `SPEC.md` §2, §3.2, §3.5.
- [ ] **T5.3** — Web demo: UI por nivel + etiqueta, fallback a `verdict`.
  - [ ] `web/app/**/*.tsx`
  - [ ] `web/lib/mcp-client.ts` (o equivalente)
- [ ] **T5.4** — Extensión Chrome (downstream, fuera de scope).

### Checkpoint Final
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm scoring:docs` verdes.
- [ ] Web demo muestra niveles correctos para 4 sitios canónicos.
- [ ] Revisión humana antes de merge a `main`.
