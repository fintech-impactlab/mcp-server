## Security

- **Never expose credentials.** No hardcodear API keys, tokens, secrets, connection strings, contraseñas ni RUTs/datos personales en código, comentarios, logs, mensajes de error, tests, fixtures, ejemplos ni en archivos `.md`.
- **Secrets viven solo en Azure Key Vault** (referencias vía `secretRef` en Container Apps) o en `.env.local` (nunca commiteado). Usar managed identity siempre que sea posible.
- **Antes de cada commit / PR / deploy:** verificar que no hay secretos en el diff. Si detectas un secreto comprometido, detén la acción y avisa al usuario para rotarlo.
- **Logs sin PII.** RUTs, emails, URLs consultadas por el usuario y cualquier input sensible deben hashearse (sha256 truncado) o excluirse antes de loguear. Alineado con Ley 21.719 (ARCO+).
- **`.gitignore` debe cubrir** `.env*`, `*.pem`, `*.key`, `secrets/`, `.azure/`, `*.tfstate*`, `node_modules/`, `dist/`, `build/`. Verificar antes del primer push.

## Code Quality

- **Validar antes de declarar listo.** Todo cambio debe pasar `tsc --noEmit`, lint (`eslint` o `biome check`) y los tests existentes antes de marcar una tarea como completa.
- **Type safety estricta.** `strict: true` en `tsconfig.json`, sin `any` implícitos ni `@ts-ignore` sin justificación en comentario. Validar inputs externos (CMF XLSX, scraping, APIs) con Zod en los bordes.
- **Inputs no confiables son hostiles por defecto.** RUTs, URLs, dominios y respuestas de fuentes externas se validan, sanitizan y limitan en tamaño antes de procesar. Nunca usar `eval`, `Function()` ni interpolación en consultas.
- **Determinismo en scoring.** El motor de reglas (`scoring/rules.ts`, `scoring/engine.ts`) es 100 % determinístico, sin LLM, sin random, sin `Date.now` salvo a través de facts inyectados. Reglas en tabla, citables. Si una rama no se puede explicar en una línea, está mal.
- **Orquestación con LLM permitida.** El MCP puede llamar a la API de Claude desde una capa de orquestación (`tools/full_evaluation` o un orquestador upstream) para clasificar inputs ambiguos (URLs cortas/incompletas, RUTs sin formato, nombres de empresa) y decidir secuencia de tools. Reglas para que sigan auditables:
  - El LLM nunca calcula `score` ni decide `verdict`. Esos siguen viniendo del motor determinístico.
  - El prompt y el modelo usado se versionan en código (no se editan en runtime).
  - Toda llamada al LLM emite `tool.call { source: "claude-api", model, tokenUsage }` para trazabilidad.
  - Fallback determinístico obligatorio si la API de Claude cae: la cadena no se rompe.
- **Errores tipados, no `throw new Error("...")` genéricos.** Cada fuente externa tiene su propia clase de error (`PhishTankError`, `CMFFetchError`, etc.) para que el cliente pueda actuar con información.
- **Defensa contra fallas externas.** Timeouts explícitos, rate-limit respetuoso (1 req/s mínimo a fuentes scrapeadas), reintentos con backoff exponencial, fallback a "datos no disponibles" sin romper la cadena.
- **Cobertura de tests obligatoria** en motor de scoring (cada regla con caso afirmativo y negativo) y en el parser de cada fuente externa (con fixtures congelados).
- **Sin código muerto.** Si no se usa, se borra. No comentar código "por si acaso".

## Response Style

- **Result first:** Lead with the code, command, or answer. No preamble like "Here's..." or "Sure, I can...".
- **No filler:** Skip pleasantries, acknowledgments, and closers ("Hope this helps", "Let me know if...").
- **No recaps:** Do not restate the request or summarize what you just did.
- **Explain only on demand:** Provide rationale only if asked, or if the solution uses a non-obvious pattern or has a side effect the user could miss. One sentence max.
- **No hedging:** Drop disclaimers like "this depends on your setup" or "one possible approach is" unless a real ambiguity exists.
- **Length cap:** ≤3 sentences for conceptual answers. For code tasks, output the diff/code and stop.
- **Format minimally:** Prose for short answers. Bullets only for 3+ parallel items. No headers for single-topic responses.
- **Ask, don't assume:** If the request is ambiguous, ask one targeted question instead of generating multiple variants.