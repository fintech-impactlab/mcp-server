# Plan — Orquestador con LLM (`smart_evaluation`)

## Contexto

El cluster B (tools) cerró con 12 tools registradas y un `full_evaluation` 100 % determinístico (commit `8addc4d`, 472 tests verde). Este nuevo plan agrega una **capa orquestadora con LLM** que cubre los inputs ambiguos que el clasificador determinístico actual no resuelve (URLs cortas, sin protocolo, con typos, RUTs sin formato, nombres con variantes), bajo las nuevas reglas de [CLAUDE.md § Code Quality](../CLAUDE.md):

- **Scoring sigue 100 % determinístico.** El LLM nunca calcula `score` ni `verdict`.
- **Orquestación admite LLM** con prompt versionado, trazabilidad y fallback obligatorio.

**Outcome esperado:** una nueva tool `smart_evaluation` registrada en el MCP que:

1. Recibe un string crudo (URL/RUT/nombre/lenguaje natural).
2. Pre-clasifica con Claude (Haiku 4.5), normaliza el input y, si es ambiguo, escala a tool-use para que el LLM decida la secuencia de tools.
3. Las tools individuales y el `score()` engine siguen siendo los mismos del cluster B — auditables y citables.
4. Fallback determinístico si la API de Claude cae: la cadena no se rompe.

## Alcance

- Cliente Anthropic embebido en `mcp-server/` (no en `web/`). El secreto vive en Key Vault.
- Tool nueva `smart_evaluation` registrada **junto** al `full_evaluation` existente — coexisten, el cliente elige.
- Cobertura de casos ambiguos:
  - URL tiny (`bit.ly/abc`) → expansión real vía HEAD.
  - URL sin protocolo (`scam.cl`).
  - URL con typo (`scaam-bank.cl`) detectado pero sin auto-corregir (Claude sugiere alternativas; el usuario decide).
  - RUT mal formateado (con/sin puntos, sin DV) → normaliza y calcula DV.
  - Nombre con variación ("Banco Falabella" / "BANCO FALABELLA SA") → normaliza para match en RPSF.
- Score consolidado **siempre** del motor de reglas, nunca del LLM.

## Non-goals

- No reemplazamos `full_evaluation`. Sigue existiendo y siendo invocable.
- No exponemos las credenciales del cliente Anthropic al cliente del MCP.
- No hay multi-entidad real en este plan (caso "compárame X vs Y") — queda diferido a un Slice posterior si se valida demanda.
- No tocamos el motor de scoring ni los parsers (siguen 100 % auditables).

## Stack

- `@anthropic-ai/sdk@latest` (a sumar en Slice 0.1).
- Modelo: `claude-haiku-4-5-20251001`. Versionado en código.
- Provider: Anthropic API directa. Key en Azure Key Vault como `anthropic-api-key`, vía `secretRef` en Container App.
- Reuso máximo de código existente: `followRedirects` para tiny URLs, `classifyFullEvalInput` como fallback determinístico, `score()` engine sin tocar.
- Tests: Anthropic SDK mockeado (no se hace fetch real en CI). Smoke contra prod sí pega API real.

## Dependency graph

```
[Slice 0: Foundations]
    │ Anthropic SDK + lib/anthropic.ts wrapper, KV secret seed,
    │ logger.event canónico para `claude.call`, prompt versioning conv
    ▼
[Slice 1: Helpers preparatorios]
    │ expandShortUrl (reusa followRedirects), normalizeRut/computeDV
    ▼
[Slice 2: Classifier (B1)]
    │ classifier.ts → Claude → JSON estructurado validado con Zod;
    │ fallback a classifyFullEvalInput si Anthropic falla
    ▼
[Slice 3: smart_evaluation (B1 path completo)]
    │ schema + handler que clasifica → llama full_evaluation con
    │ input normalizado; tool registrada en src/index.ts
    ▼
[Slice 4: Tool-use escalation (B3 path)]   ⚠️ ambiguous
    │ catálogo de tools → Anthropic tool definitions; loop tool-use
    │ con max iters; agregación de facts; score sigue del engine
    ▼
[Slice 5: Deploy + smoke]
    │ Bicep secretRef wiring + KV seed + push + smoke real
    ▼
[Slice 6: Docs + cost guardrails]
      README, SPEC, doc rotación key, costo estimado
```

## Checkpoints

| ID | Después de | Criterio |
|----|------------|----------|
| **CP-1** | Slice 2 | Classifier funciona en tests con SDK mockeado; fallback determinístico verificado con caso `Anthropic API down`. |
| **CP-2** | Slice 3 | `smart_evaluation` end-to-end local: input "scam.cl" → clasifica → expande a "https://scam.cl" → delega a `full_evaluation` → mismo verdict que llamando `full_evaluation` directamente con la URL completa. Coexiste con `full_evaluation` sin afectarlo. |
| **CP-3** | Slice 4 | Input ambiguo ("¿es scam crediacceso.cash?") escala a tool-use; cost cap (max iters, max tokens) respetado; total tokens < umbral en log. |
| **CP-4** | Slice 5 | Deployed; smoke contra prod retorna `claude.call` events en logs y respuesta válida; rate-limit handling verificado. |

---

## Slice 0 — Foundations

Sin esto, cada componente reinventa el cliente de Claude y el logging.

- **0.1** Sumar `@anthropic-ai/sdk` a `mcp-server/package.json`.
  - **AC:** dependencia añadida vía `pnpm add @anthropic-ai/sdk`. Versión pinned. `pnpm install --frozen-lockfile` pasa en CI.
  - **Verify:** `grep '@anthropic-ai/sdk' mcp-server/package.json` retorna línea. Build TS sigue verde.

- **0.2** Wrapper en `src/lib/anthropic.ts`.
  - **AC:** módulo expone `createAnthropicClient(config)` y `callClaude(client, params)` con:
    - Timeout configurable (default 8 s).
    - Retry exponencial 3× **solo** en 5xx y errores de red. **No** retriea 429 (respetar rate-limit del provider).
    - Captura `usage.input_tokens` + `usage.output_tokens` para log.
    - Wrap de errores en `ClaudeAPIError extends ToolError` (source: `claude-api`).
    - Lee API key vía `process.env.ANTHROPIC_API_KEY`. Si está vacío, throwea con mensaje claro al boot.
  - **Verify:** `pnpm test -- anthropic` con SDK mockeado: 5xx retriea, 429 no retriea, timeout retriea, success captura tokens. Sin tests que peguen API real en CI.

- **0.3** Convención de versionado de prompts.
  - **AC:** carpeta `src/tools/smart_evaluation/prompts/` (creada en Slice 2). Cada prompt vive en su propio archivo `<name>-v<N>.ts` exportando `{ id, version, system, schema, hashEsperado }`. Test snap del hash detecta cambios accidentales.
  - **Verify:** se valida en Slice 2.

- **0.4** Logging canónico `claude.call`.
  - **AC:** documentado en `mcp-server/CONVENTIONS.md`. Forma: `{ event: "claude.call", toolName, promptId, promptVersion, model, durationMs, inputTokens, outputTokens, success, retries }`. **Nunca** loguea el contenido del prompt ni la respuesta.
  - **Verify:** test unitario verifica que un call exitoso emite el evento con shape esperado y que el contenido del prompt no aparece en el log capturado.

- **0.5** Errores tipados en `src/lib/errors.ts`.
  - **AC:** agregar `ClaudeAPIError = defineSourceError("ClaudeAPIError", "claude-api")`. Mismo patrón que el resto.
  - **Verify:** `pnpm test -- errors` cubre serialización del nuevo error.

> ⛳ **Sin checkpoint** — Slice 0 es habilitador puro.

---

## Slice 1 — Helpers preparatorios

Atómicos, sin dependencia de Anthropic. Permiten implementar el classifier sin re-escribir lógica.

- **1.1** `expandShortUrl(rawUrl, fetcher?)`.
  - **AC:** módulo `src/tools/smart_evaluation/helpers/expand-url.ts`. Reusa `followRedirects` de `analyze_domain/clients/redirects.ts`. Si la URL viene sin protocolo (`scam.cl`) o sin scheme (`//foo.cl`), normaliza a `https://...`. Retorna `{ originalUrl, finalUrl, hops, isShortened: boolean }`. `isShortened: true` si hops ≥ 1 y el host original está en una lista corta de shorteners conocidos (bit.ly, t.co, tinyurl.com, ow.ly, goo.gl, lnkd.in, buff.ly, is.gd, cutt.ly).
  - **Verify:** unit tests con fetcher mockeado: URL completa sin redirect → no shortening; bit.ly con 1 hop → shortened; URL sin protocolo → normaliza y retorna.

- **1.2** `normalizeRut(raw)` + `computeDV(numeric)`.
  - **AC:** módulo `src/tools/smart_evaluation/helpers/rut.ts`. `normalizeRut("76.123.456-7")` → `"76123456-7"`. Si llega sin DV ("76123456"), `computeDV` lo calcula (algoritmo módulo 11) y retorna canonical form. Si el DV es inválido, marca `validDV: false`.
  - **Verify:** unit tests con vectores conocidos (ej. "76.123.456-7", "5126663-3", "11111111-1", inválidos).

> ⛳ **Sin checkpoint** — entrega utilidades sin LLM.

---

## Slice 2 — Classifier

Primer uso real del cliente Anthropic. La salida es un objeto estructurado consumible por el orquestador.

- **2.1** Prompt v1 versionado.
  - **AC:** `src/tools/smart_evaluation/prompts/classify-v1.ts`. System prompt corto (≤ 1 KB), describe objetivo, lista los 5 tipos posibles (`url`, `domain`, `rut`, `name`, `ambiguo`), pide salida JSON estricta. Constante `CLASSIFY_V1 = { id: "classify", version: "1", system: "...", outputSchemaJson: "..." }`. Hash sha256 del system prompt en una constante para test snap.
  - **Verify:** test verifica que `sha256(CLASSIFY_V1.system)` coincide con la constante. Si alguien edita el prompt sin bumpear version, el test falla.

- **2.2** `classifyInput(raw, deps)` en `src/tools/smart_evaluation/classifier.ts`.
  - **AC:** Recibe string crudo + deps `{ anthropic, expandShortUrl, normalizeRut, fallbackClassifier }`. Pasos:
    1. Llama Claude con el prompt v1 + el input. Modelo `claude-haiku-4-5-20251001`.
    2. Valida la respuesta JSON con Zod (`ClassifierOutputSchema`).
    3. Si type=`url`/`domain`, llama `expandShortUrl` para resolver tiny/sin-protocolo y agrega el resultado al output.
    4. Si type=`rut`, llama `normalizeRut`/`computeDV` y agrega el RUT canónico al output.
    5. Emite `claude.call` event con tokens.
    6. Si Claude falla (timeout, 5xx tras 3 retries, parse error de JSON), llama `fallbackClassifier` (que envuelve `classifyFullEvalInput` regex existente) y marca `classifierSource: "deterministic-fallback"`.
  - Schema output (Zod):
    ```ts
    {
      type: "url" | "domain" | "rut" | "name" | "ambiguo",
      normalized: string,
      originalInput: string,
      classifierConfidence: number, // 0-1
      classifierSource: "claude" | "deterministic-fallback",
      details: {
        expandedFromTinyUrl?: string,
        rutComputedDV?: string,
        suggestedAlternatives?: string[],
      },
    }
    ```
  - **Verify:** `pnpm test -- classifier` con Anthropic mockeado:
    - Caso URL completa → type=url, normalized = la URL
    - Caso bit.ly → type=url, expandedFromTinyUrl set
    - Caso "76123456" → type=rut, rutComputedDV set
    - Caso "Banco Falabella SA" → type=name, normalized en uppercase
    - Caso "¿es scam x.com?" → type=ambiguo (Claude lo decide)
    - Caso Anthropic 503 después de 3 retries → fallback determinístico kicks in, `classifierSource: "deterministic-fallback"`

> ⛳ **Checkpoint CP-1** — classifier funciona en tests + fallback verificado. Antes de Slice 3, validar manualmente con un puñado de inputs reales contra Anthropic API local (no commitear evidencia, solo confirmar).

---

## Slice 3 — `smart_evaluation` tool (B1 path)

Sin tool-use todavía. Solo clasificación + delegación a `full_evaluation`.

- **3.1** Schema en `src/tools/smart_evaluation/schema.ts`.
  - **AC:** Input `{ input: string, text?: string, situacion?: Situacion }` (mismo shape que `full_evaluation` para que sea drop-in). Output extiende `OutputSchema` de `full_evaluation` con un campo extra `classification: ClassifierOutputSchema`. Z `OutputSchema` exportado.
  - **Verify:** `pnpm test -- smart_evaluation/schema` valida shape.

- **3.2** Handler en `src/tools/smart_evaluation/index.ts`.
  - **AC:** factory `createSmartEvaluationTool(deps)`. Deps:
    ```ts
    {
      anthropic: AnthropicClient,
      fullEvaluationTool: ToolDefinition<...>, // inyectada
      ...
    }
    ```
    Flujo:
    1. Llama `classifyInput(input, deps)` → `classification`.
    2. Construye un `FullEvalInput` con `input: classification.normalized`, hereda `text`/`situacion`.
    3. Llama `fullEvaluationTool.handler(fullEvalInput)`.
    4. Devuelve `{ ...fullEvalOutput, classification }`.
  - El score y reasons siguen viniendo del motor de reglas dentro de `full_evaluation`. El LLM no los toca.
  - **Verify:** test E2E con classifier y fullEvaluation ambos stubbeados:
    - Input "bit.ly/scam" → classification.expandedFromTinyUrl set, fullEvaluation recibe URL expandida.
    - Input "76123456" → classification.rutComputedDV set, fullEvaluation recibe RUT canónico.
    - Input "Empresa X" → classification.type=name, fullEvaluation recibe nombre normalizado.
    - Anthropic falla → classification.classifierSource="deterministic-fallback", fullEvaluation recibe input crudo (sin expansión); el flujo no rompe.

- **3.3** Registrar la tool en `src/index.ts` con todos los deps cableados.
  - **AC:** `smart_evaluation` aparece en `tools/list`. La tool se construye después de `full_evaluation` para inyectarla como dep. Anthropic client se construye una vez al boot y se reusa.
  - **Verify:** `pnpm dev:server` levanta sin errores; `tools/list` incluye `smart_evaluation` como #13. Tests existentes siguen verde (regresión cero).

> ⛳ **Checkpoint CP-2** — `smart_evaluation` end-to-end local. Validar paridad con `full_evaluation`: el mismo input (URL completa) en ambas debe producir el mismo verdict. Discrepancia = bug en clasificador o handler.

---

## Slice 4 — Tool-use escalation (B3 path) ⚠️

Cuando el classifier devuelve `type: "ambiguo"` o detecta multi-entidad, en lugar de delegar a `full_evaluation`, **el handler escala** a un loop tool-use donde Claude decide qué tools llamar.

- **4.1** Conversor de catálogo a tool definitions Anthropic.
  - **AC:** `src/tools/smart_evaluation/tool-bridge.ts` expone `toolsToAnthropicTools(tools, allowList)` que convierte cada `ToolDefinition.inputSchema` (Zod) a JSON Schema (vía `zod-to-json-schema` — agregar dep en Slice 0) y produce el array que Anthropic espera. `allowList` permite restringir cuáles tools puede invocar Claude.
  - **Verify:** test convierte el catálogo de las 12 tools y valida shape esperado.

- **4.2** Tool-use loop en `src/tools/smart_evaluation/tool-use-loop.ts`.
  - **AC:** función `runToolUseLoop({ anthropic, tools, userMessage, maxIters, maxTotalTokens })`. Hace `messages.create` con `tools=...`, si la respuesta tiene `stop_reason: "tool_use"`, ejecuta la tool localmente vía `tools[name].handler(input)`, retorna el resultado a Claude en otro `messages.create`. Repite hasta `stop_reason: "end_turn"` o `maxIters`. Si supera `maxTotalTokens` corta y reporta `stoppedAt: "token_cap"`.
  - **Verify:** test con SDK mockeado para 3 iteraciones de tool_use seguidas de end_turn:
    - Iter 1: Claude pide `check_blacklist` → handler retorna mock blacklist output → Claude recibe.
    - Iter 2: Claude pide `analyze_domain` → handler retorna mock domain output → Claude recibe.
    - Iter 3: Claude responde end_turn con summary.
    - Cap: si Claude pide >5 tools, loop corta y reporta.

- **4.3** Integración en handler `smart_evaluation`.
  - **AC:** si `classification.type === "ambiguo"`, en lugar de delegar a `full_evaluation`, ejecuta `runToolUseLoop` con allow-list de las 11 tools granulares (no `full_evaluation`, no `smart_evaluation` ricamente). Acumula los outputs de cada tool en una estructura igual al `breakdown` de `full_evaluation`. Llama `score()` con los facts agregados manualmente. Devuelve el mismo output shape que `full_evaluation` + el `classification` + un campo `toolUseTrace: [{ tool, input, output, durationMs }]`.
  - **Verify:** test E2E ambiguo con SDK mockeado: input "es scam crediacceso.cash" → clasifica ambiguo → tool-use llama 2 tools → score consolidado correcto.

- **4.4** Cost guardrails.
  - **AC:** límites configurables vía dep:
    - `maxIters: 5` (default)
    - `maxTotalTokens: 20_000` (default; suficiente para 5 tool calls con outputs medianos)
    - `maxCostUsd: 0.05` (estimación local, default; abort si proyección excede)
  - Si se alcanza cualquier límite, el output incluye `stoppedAt: "iter_cap" | "token_cap" | "cost_cap"` y un disclaimer "evaluación parcial".
  - **Verify:** test forzando 6 iteraciones con maxIters=5 → corta en iter 5; test con tokens muy altos → corta por tokens.

> ⛳ **Checkpoint CP-3** — input ambiguo escala correctamente; cost caps funcionan; total token usage queda registrado en log para auditoría.

---

## Slice 5 — Deploy + smoke

- **5.1** Seed `anthropic-api-key` en KV.
  - **AC:** `az keyvault secret set --vault-name kv-fintech-dev-ic66pjdlb --name anthropic-api-key --value <API_KEY>`. Documentado en `docs/SECRETS.md` (a crear en Slice 6).
  - **Verify:** `az keyvault secret show --vault-name $KV --name anthropic-api-key --query attributes.enabled` → `true`.

- **5.2** Bicep: secretRef + envVar wiring.
  - **AC:** en `infra/main.bicep`, agregar al `mcpApp`:
    ```bicep
    secrets: [
      { name: 'mcp-api-keys', keyVaultUrl: '...' }
      { name: 'anthropic-api-key', keyVaultUrl: '${keyVault.outputs.uri}secrets/anthropic-api-key' }
    ]
    secretEnvVars: [
      { name: 'MCP_API_KEYS_SECRET', secretRef: 'mcp-api-keys' }
      { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
    ]
    ```
  - Asegurar que la UAI del mcpApp tenga permiso `Key Vault Secrets User` sobre el secret `anthropic-api-key` (ya cubierto por el role scope-specific de Slice A2 si está vault-wide; sino agregar role assignment).
  - **Verify:** `az deployment group create` exitoso. Container App revision tras deploy muestra `ANTHROPIC_API_KEY` cableado en `secretEnvVars`.

- **5.3** Push y verificar deploy CI.
  - **AC:** commit + push a main; GitHub Actions hace build + push imagen + revision update. Verificar `az containerapp logs show -n ca-mcp-fintech-dev` muestra `server.tools_ready { count: 13 }` en lugar de 12.
  - **Verify:** `tools/list` en producción retorna 13 tools incluyendo `smart_evaluation`.

- **5.4** Smoke real contra prod.
  - **AC:** invocar `smart_evaluation` con 4 inputs:
    1. URL completa: `https://crediacceso.cash/` → verdict consistente con full_evaluation.
    2. URL tiny: `bit.ly/<algo-real>` (si tenés alguno real) → expansión visible en classification.
    3. RUT sin formato: `76123456` → DV calculado.
    4. Lenguaje natural: `es scam crediacceso.cash?` → clasifica ambiguo, escala a tool-use.
  - Logs en Log Analytics muestran `claude.call` events con tokens.
  - **Verify:** comando documentado en docs (a crear en Slice 6); las 4 invocaciones devuelven respuestas válidas en < 10 s p95.

> ⛳ **Checkpoint CP-4** — deployed y smoke verde.

---

## Slice 6 — Docs + cost guardrails

- **6.1** `docs/SECRETS.md`.
  - **AC:** documenta cómo seedar/rotar `anthropic-api-key`, qué role necesita la UAI, comando para revocar la key vieja en Anthropic console.
  - **Verify:** `test -f docs/SECRETS.md`.

- **6.2** Sección "Smart evaluation" en README.md.
  - **AC:** describe la nueva tool, cuándo usarla vs `full_evaluation`, ejemplos de inputs ambiguos cubiertos, lista de fallbacks.
  - **Verify:** `grep "smart_evaluation" README.md` retorna ≥ 3 líneas.

- **6.3** Cost estimation doc.
  - **AC:** `docs/COST.md`. Estimación basada en mediciones reales de Slice 5.4: tokens promedio por invocación, costo USD/invocación con Haiku, proyección a N invocaciones/día. Tabla.
  - **Verify:** `test -f docs/COST.md` con tabla.

- **6.4** Actualizar `SCORING.md` (no agrega reglas, pero documentar que el LLM no influye en el score).
  - **AC:** agregar nota al inicio: "El score se calcula 100 % vía `scoring/rules.ts`. La capa orquestadora con LLM (`smart_evaluation`) puede decidir qué tools invocar, pero los scores parciales que esas tools retornan vienen del motor determinístico — el LLM nunca los toca."
  - **Verify:** grep verifica la línea presente.

> ⛳ **Checkpoint CP-E (final)** — handover. Cliente puede invocar `smart_evaluation` con inputs ambiguos y obtener verdict + score auditable. Cost cap operativo. Docs entregadas.

---

## Verificación end-to-end

```bash
# 1. 13 tools registradas (fueron 12)
curl -fsSL https://<ca-mcp-fqdn>/mcp/tools/list \
  -H "Authorization: Bearer $KEY" \
  | jq '.tools | length'   # → 13

# 2. smart_evaluation existe
curl ... | jq '.tools[].name' | grep smart_evaluation

# 3. Input tiny URL
curl -X POST ... -d '{"name":"smart_evaluation","arguments":{"input":"bit.ly/scam-test"}}' \
  | jq '.classification.details.expandedFromTinyUrl'  # → string non-empty

# 4. Input RUT sin DV
... arguments={"input":"76123456"} ... | jq '.classification.details.rutComputedDV'

# 5. Input ambiguo escala a tool-use
... arguments={"input":"es scam crediacceso.cash?"} ... | jq '.toolUseTrace | length'  # > 0

# 6. Logs claude.call presentes
az monitor log-analytics query --workspace ... --analytics-query \
  "ContainerAppConsoleLogs_CL | where Log_s contains 'claude.call' | take 5"

# 7. Score sigue 100% determinístico
diff <(jq '.score' <(curl ... full_evaluation con URL X)) \
     <(jq '.score' <(curl ... smart_evaluation con URL X))   # → idénticos
```

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Anthropic API down | Fallback determinístico ya forma parte del classifier (Slice 2.2). En Slice 5 se valida manualmente cortando red al SDK. |
| Costo descontrolado en tool-use | Caps duros (Slice 4.4): max 5 iteraciones, max 20k tokens, max 0.05 USD/llamada (estimación). Slice 6.3 mide costo real y ajusta caps. |
| Prompt drift accidental | Slice 0.3 + 2.1: hash del system prompt en constante; test verifica el hash. |
| LLM "sesga" el score | Slice 4.3: el `score` se calcula con `scoring/engine.ts` sobre los facts producidos por las tools — el LLM nunca toca scores. Slice 6.4 lo documenta. |
| Input PII filtrado al LLM | El input se pasa al prompt pero **nunca** se loguea (Slice 0.4). Anthropic, no nuestro server, ve el input. Si se requiere zero-PII al LLM, bloqueamos en Slice posterior. |
