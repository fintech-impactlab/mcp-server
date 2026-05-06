# TODO — Orquestador con LLM (`smart_evaluation`)

> Spec: [tasks/plan-orchestrator.md](plan-orchestrator.md)
> Convención: cada tarea tiene **AC** y **Verify**. No marcar `[x]` sin pasar Verify.

---

## Slice 0 — Foundations

- [x] **0.1** `pnpm add @anthropic-ai/sdk` en `mcp-server/`.
  - **AC:** dep en `package.json` con versión pinned. `pnpm install --frozen-lockfile` pasa.
  - **Verify:** `grep '@anthropic-ai/sdk' mcp-server/package.json` ≥ 1 línea. `pnpm build` verde.

- [x] **0.2** Wrapper `src/lib/anthropic.ts` con timeout, retry 5xx, captura tokens.
  - **AC:** expone `createAnthropicClient`, `callClaude`. Errores envuelven en `ClaudeAPIError`. No retriea 429.
  - **Verify:** `pnpm test -- anthropic` con SDK mockeado: 5xx retriea (3×), 429 no retriea, timeout retriea, success captura tokens.

- [x] **0.3** Convención de prompt versioning documentada en `mcp-server/CONVENTIONS.md`.
  - **AC:** sección nueva describe estructura `prompts/<name>-v<N>.ts`, requisito de hash sha256 en constante, test snap.
  - **Verify:** `grep -A 10 "prompt versioning" mcp-server/CONVENTIONS.md`.

- [x] **0.4** Logger event canónico `claude.call` documentado.
  - **AC:** `mcp-server/CONVENTIONS.md` lista el shape: `{ event: "claude.call", toolName, promptId, promptVersion, model, durationMs, inputTokens, outputTokens, success, retries }`. Prohíbe loguear contenido del prompt o respuesta.
  - **Verify:** test unitario en wrapper verifica que no aparece prompt content en log capturado.

- [x] **0.5** `ClaudeAPIError` en `src/lib/errors.ts`.
  - **AC:** `defineSourceError("ClaudeAPIError", "claude-api")`. Type export.
  - **Verify:** `pnpm test -- errors` cubre nuevo error.

---

## Slice 1 — Helpers preparatorios

- [ ] **1.1** `src/tools/smart_evaluation/helpers/expand-url.ts`.
  - **AC:** `expandShortUrl(rawUrl, fetcher?)` retorna `{ originalUrl, finalUrl, hops, isShortened }`. Reusa `followRedirects`. Lista de shorteners conocidos: bit.ly, t.co, tinyurl.com, ow.ly, goo.gl, lnkd.in, buff.ly, is.gd, cutt.ly.
  - **Verify:** unit tests con fetcher mockeado: URL completa, bit.ly con 1 hop, URL sin protocolo (normaliza a https://).

- [ ] **1.2** `src/tools/smart_evaluation/helpers/rut.ts`.
  - **AC:** `normalizeRut(raw)`, `computeDV(numeric)`. Algoritmo módulo 11. Marca `validDV: false` si no coincide.
  - **Verify:** test con vectores conocidos (76.123.456-7, 5126663-3, 11111111-1, inválidos).

---

## Slice 2 — Classifier

- [ ] **2.1** Prompt v1 en `src/tools/smart_evaluation/prompts/classify-v1.ts`.
  - **AC:** const `CLASSIFY_V1 = { id, version: "1", system, outputSchemaJson, hashEsperado }`. Hash sha256 del system prompt verificado en test.
  - **Verify:** test `pnpm test -- classify-v1` verifica hash actual = constante.

- [ ] **2.2** `src/tools/smart_evaluation/classifier.ts`.
  - **AC:** `classifyInput(raw, deps)` con flujo: Claude → Zod parse → expandir URL si aplica → normalizar RUT si aplica → emit `claude.call` → fallback determinístico si Anthropic falla.
  - **Verify:** `pnpm test -- classifier` con SDK mockeado:
    - URL completa → type=url, normalized = URL tal cual
    - bit.ly/abc → type=url, expandedFromTinyUrl set
    - "76123456" → type=rut, rutComputedDV set
    - "Banco Falabella SA" → type=name, normalized uppercase
    - "¿es scam x.com?" → type=ambiguo
    - Anthropic 503 tras 3 retries → fallback determinístico kicks in

> ⛳ **CP-1** — classifier funciona en tests + fallback verificado.

---

## Slice 3 — `smart_evaluation` tool (B1 path)

- [ ] **3.1** `src/tools/smart_evaluation/schema.ts`.
  - **AC:** Input shape igual a `full_evaluation`. Output extiende el de `full_evaluation` con campo `classification: ClassifierOutputSchema`. `OutputSchema` re-exportado.
  - **Verify:** `pnpm test -- smart_evaluation/schema` valida shape.

- [ ] **3.2** Handler `src/tools/smart_evaluation/index.ts`.
  - **AC:** `createSmartEvaluationTool(deps)` con deps `{ anthropic, fullEvaluationTool, ... }`. Flujo: classify → normalizar → llamar `fullEvaluationTool.handler` → mergear `classification` en output.
  - **Verify:** test E2E con classifier y fullEvaluation stubbeados (4 casos del Slice 2.2 + paridad de score).

- [ ] **3.3** Registrar tool en `src/index.ts` con todos los deps cableados.
  - **AC:** `tools/list` retorna 13 tools. Anthropic client se construye una vez al boot. La tool aparece después de `full_evaluation` en orden de registración.
  - **Verify:** `pnpm dev:server` boot sin errores; logs muestran `server.tool_registered { toolName: "smart_evaluation" }`. Tests existentes siguen verde.

> ⛳ **CP-2** — `smart_evaluation` end-to-end local con paridad vs `full_evaluation` para inputs simples.

---

## Slice 4 — Tool-use escalation (B3 path) ⚠️

- [ ] **4.1** `src/tools/smart_evaluation/tool-bridge.ts`.
  - **AC:** `toolsToAnthropicTools(tools, allowList)` convierte Zod schema → JSON Schema (vía `zod-to-json-schema`, agregar dep). Retorna array Anthropic tool definitions.
  - **Verify:** test convierte el catálogo de las 11 tools granulares y valida shape esperado.

- [ ] **4.2** `src/tools/smart_evaluation/tool-use-loop.ts`.
  - **AC:** `runToolUseLoop({ anthropic, tools, userMessage, maxIters, maxTotalTokens, maxCostUsd })`. Loop hasta `stop_reason: "end_turn"` o cap. Acumula `{ tool, input, output, durationMs }` en trace. Retorna `{ trace, accumulatedFacts, finalMessage, stoppedAt }`.
  - **Verify:** test con SDK mockeado:
    - 3 iteraciones tool_use → end_turn: trace tiene 3 entries.
    - 6 iteraciones simuladas con maxIters=5 → corta y reporta `stoppedAt: "iter_cap"`.
    - tokens > maxTotalTokens → corta, `stoppedAt: "token_cap"`.

- [ ] **4.3** Integración en handler `smart_evaluation`.
  - **AC:** si `classification.type === "ambiguo"`, ejecuta `runToolUseLoop` con allow-list de las 11 tools granulares. Acumula facts manualmente desde los outputs y pasa a `score()`. Output incluye `classification`, `toolUseTrace`, mismo shape que `full_evaluation` para el resto.
  - **Verify:** test E2E ambiguo con SDK mockeado: input "es scam crediacceso.cash?" → clasifica ambiguo → 2 tools llamadas → score consolidado.

- [ ] **4.4** Cost guardrails configurables.
  - **AC:** caps por defecto `maxIters=5`, `maxTotalTokens=20000`, `maxCostUsd=0.05`. Sobrepasar cualquier cap → `stoppedAt: "<cap_name>"` + disclaimer "evaluación parcial".
  - **Verify:** tests cubren los 3 caps.

> ⛳ **CP-3** — input ambiguo escala correctamente; cost caps operativos.

---

## Slice 5 — Deploy + smoke

- [ ] **5.1** Seed `anthropic-api-key` en KV.
  - **AC:** `az keyvault secret set --vault-name kv-fintech-dev-ic66pjdlb --name anthropic-api-key --value <KEY>`.
  - **Verify:** `az keyvault secret show ... --query attributes.enabled` → `true`.

- [ ] **5.2** Bicep secretRef + envVar wiring para `mcpApp`.
  - **AC:** `infra/main.bicep` agrega secret `anthropic-api-key` y `secretEnvVars` con `name: ANTHROPIC_API_KEY`. UAI tiene rol `Key Vault Secrets User` sobre el secret.
  - **Verify:** `az deployment group create` exitoso; `az containerapp show -n ca-mcp-fintech-dev` muestra el envVar cableado.

- [ ] **5.3** Push y verificar deploy CI.
  - **AC:** commit + push; CI completa build/push/deploy. Logs muestran `server.tools_ready { count: 13 }`.
  - **Verify:** `tools/list` en prod retorna 13 tools incluyendo `smart_evaluation`.

- [ ] **5.4** Smoke contra prod con 4 inputs (URL completa, tiny URL, RUT sin formato, lenguaje natural ambiguo).
  - **AC:** las 4 invocaciones < 10 s p95. Logs en Log Analytics muestran `claude.call` events con tokens.
  - **Verify:** documentado en `docs/SMOKE-SMART.md` (script `bash scripts/smoke-smart.sh` opcional).

> ⛳ **CP-4** — deployed + smoke verde.

---

## Slice 6 — Docs + cost

- [ ] **6.1** `docs/SECRETS.md` cubriendo `anthropic-api-key` (seed, rotación, role).
  - **Verify:** `test -f docs/SECRETS.md`.

- [ ] **6.2** Sección "Smart evaluation" en `README.md`.
  - **AC:** describe la tool, cuándo usarla, ejemplos cubiertos, fallbacks.
  - **Verify:** `grep "smart_evaluation" README.md` ≥ 3 líneas.

- [ ] **6.3** `docs/COST.md` con estimaciones reales (tokens promedio, USD/invocación con Haiku, proyección).
  - **Verify:** `test -f docs/COST.md` con tabla.

- [ ] **6.4** Nota en `SCORING.md`: el LLM nunca calcula scores.
  - **Verify:** `grep "LLM nunca" SCORING.md` ≥ 1 línea.

> ⛳ **CP-E (final)** — handover.
